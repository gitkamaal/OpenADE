package daemon

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// SVG is parsed and re-serialized before reaching WebKit. This intentionally
// admits only static vector/text primitives; it does not attempt to reproduce
// the pinned source's complete usvg conversion pipeline.
const maxWorkspaceSVGBytes = 8 * 1024 * 1024
const maxWorkspaceSVGNodes = 10_000
const maxWorkspaceSVGDepth = 64

var svgLengthPattern = regexp.MustCompile(`^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:px)?\s*$`)
var svgIDPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$`)
var svgLocalPaintPattern = regexp.MustCompile(`^url\(\s*#[A-Za-z_][A-Za-z0-9_.:-]{0,127}\s*\)$`)
var svgHexColorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{3,8}$`)
var svgNamedColorPattern = regexp.MustCompile(`^[A-Za-z]+$`)
var svgFunctionalColorPattern = regexp.MustCompile(`^(?:rgb|rgba|hsl|hsla)\([0-9.,%/+\- ]{1,100}\)$`)

var staticSVGElements = map[string]bool{
	"svg": true, "g": true, "defs": true, "path": true, "rect": true,
	"circle": true, "ellipse": true, "line": true, "polyline": true,
	"polygon": true, "text": true, "tspan": true, "linearGradient": true,
	"radialGradient": true, "stop": true, "clipPath": true,
}

var staticSVGAttributes = map[string]bool{
	"id": true, "viewBox": true, "x": true, "y": true, "x1": true, "x2": true,
	"y1": true, "y2": true, "width": true, "height": true, "cx": true,
	"cy": true, "r": true, "rx": true, "ry": true, "fx": true, "fy": true,
	"offset": true, "points": true, "d": true, "transform": true,
	"gradientTransform": true, "gradientUnits": true, "spreadMethod": true,
	"fill": true, "fill-rule": true, "fill-opacity": true, "stroke": true,
	"stroke-width": true, "stroke-opacity": true, "stroke-linecap": true,
	"stroke-linejoin": true, "stroke-miterlimit": true,
	"stroke-dasharray": true, "stroke-dashoffset": true,
	"opacity": true, "clip-path": true, "clip-rule": true,
	"stop-color": true, "stop-opacity": true, "font-size": true,
	"font-family": true, "font-weight": true, "font-style": true,
	"text-anchor": true, "dominant-baseline": true, "display": true,
	"visibility": true, "preserveAspectRatio": true,
}

type boundedSVGWriter struct{ bytes.Buffer }

func (b *boundedSVGWriter) Write(data []byte) (int, error) {
	if b.Len()+len(data) > maxWorkspaceSVGBytes {
		return 0, fmt.Errorf("prepared SVG exceeds 8 MiB")
	}
	return b.Buffer.Write(data)
}

func svgLength(value string) (float64, bool) {
	if !svgLengthPattern.MatchString(value) {
		return 0, false
	}
	parsed, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(value), "px"), 64)
	return parsed, err == nil && parsed > 0 && parsed <= 4096 && !math.IsInf(parsed, 0) && !math.IsNaN(parsed)
}

func svgViewBox(value string) (string, float64, float64, bool) {
	fields := strings.Fields(strings.ReplaceAll(value, ",", " "))
	if len(fields) != 4 {
		return "", 0, 0, false
	}
	var values [4]float64
	for index, field := range fields {
		parsed, err := strconv.ParseFloat(field, 64)
		if err != nil || math.IsInf(parsed, 0) || math.IsNaN(parsed) || math.Abs(parsed) > 1_000_000 {
			return "", 0, 0, false
		}
		values[index] = parsed
	}
	if values[2] <= 0 || values[3] <= 0 {
		return "", 0, 0, false
	}
	return strings.Join(fields, " "), values[2], values[3], true
}

func safeSVGAttribute(name, value string) bool {
	if !staticSVGAttributes[name] || len(value) > 1_000_000 || strings.Contains(value, "\\") {
		return false
	}
	for _, char := range value {
		if unicode.IsControl(char) || char == '<' || char == '>' {
			return false
		}
	}
	lower := strings.ToLower(strings.TrimSpace(value))
	if strings.Contains(lower, "javascript:") || strings.Contains(lower, "data:") || strings.Contains(lower, "@import") || strings.Contains(lower, "expression(") {
		return false
	}
	if name == "id" {
		return svgIDPattern.MatchString(value)
	}
	if name == "fill" || name == "stroke" || name == "stop-color" || name == "clip-path" {
		if svgLocalPaintPattern.MatchString(value) {
			return true
		}
		if name == "clip-path" {
			return lower == "none"
		}
		return svgHexColorPattern.MatchString(value) || svgNamedColorPattern.MatchString(value) || svgFunctionalColorPattern.MatchString(value)
	}
	if strings.Contains(lower, "url(") {
		return false
	}
	if name == "d" && len(value) > 256_000 {
		return false
	}
	return true
}

func svgAttributes(start xml.StartElement, root bool) ([]xml.Attr, error) {
	values := make(map[string]string)
	styleValues := make(map[string]string)
	for _, attr := range start.Attr {
		if attr.Name.Space != "" {
			continue
		}
		if attr.Name.Local == "style" {
			// A style declaration is accepted only when each property can be
			// represented by the same bounded presentation-attribute policy.
			for _, declaration := range strings.Split(attr.Value, ";") {
				parts := strings.SplitN(declaration, ":", 2)
				if len(parts) != 2 {
					continue
				}
				name, value := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
				if safeSVGAttribute(name, value) && name != "id" && name != "viewBox" {
					styleValues[name] = value
				}
			}
			continue
		}
		if safeSVGAttribute(attr.Name.Local, attr.Value) {
			values[attr.Name.Local] = attr.Value
		}
	}
	// SVG style declarations outrank presentation attributes regardless of
	// their order in the source XML.
	for name, value := range styleValues {
		values[name] = value
	}
	if root {
		viewBox, viewWidth, viewHeight, hasViewBox := svgViewBox(values["viewBox"])
		width, hasWidth := svgLength(values["width"])
		height, hasHeight := svgLength(values["height"])
		if !hasWidth && hasViewBox {
			width, hasWidth = viewWidth, true
		}
		if !hasHeight && hasViewBox {
			height, hasHeight = viewHeight, true
		}
		if !hasWidth || !hasHeight || width > 4096 || height > 4096 || width*height > 4_000_000 {
			return nil, fmt.Errorf("SVG dimensions exceed preview limit")
		}
		values["width"] = strconv.FormatFloat(width, 'f', -1, 64)
		values["height"] = strconv.FormatFloat(height, 'f', -1, 64)
		if hasViewBox {
			values["viewBox"] = viewBox
		} else {
			values["viewBox"] = "0 0 " + values["width"] + " " + values["height"]
		}
	}
	attributes := make([]xml.Attr, 0, len(values)+1)
	if root {
		attributes = append(attributes, xml.Attr{Name: xml.Name{Local: "xmlns"}, Value: "http://www.w3.org/2000/svg"})
	}
	// Attribute ordering does not affect rendering. Re-serialization avoids
	// forwarding namespace declarations, event handlers or external hrefs.
	keys := make([]string, 0, len(values))
	for name := range values {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	for _, name := range keys {
		value := values[name]
		attributes = append(attributes, xml.Attr{Name: xml.Name{Local: name}, Value: value})
	}
	return attributes, nil
}

func sanitizeWorkspaceSVG(data []byte) ([]byte, error) {
	if len(data) == 0 || len(data) > maxWorkspaceSVGBytes {
		return nil, fmt.Errorf("choose an SVG up to 8 MiB")
	}
	decoder := xml.NewDecoder(bytes.NewReader(data))
	output := &boundedSVGWriter{}
	encoder := xml.NewEncoder(output)
	var stack []string
	depth, skipped, nodes := 0, 0, 0
	rootSeen, rootClosed := false, false
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid SVG XML")
		}
		switch item := token.(type) {
		case xml.Directive:
			return nil, fmt.Errorf("SVG directives are not supported")
		case xml.StartElement:
			depth++
			nodes++
			if depth > maxWorkspaceSVGDepth || nodes > maxWorkspaceSVGNodes {
				return nil, fmt.Errorf("SVG exceeds complexity limit")
			}
			if skipped > 0 {
				skipped++
				continue
			}
			if !rootSeen {
				if item.Name.Local != "svg" || (item.Name.Space != "" && item.Name.Space != "http://www.w3.org/2000/svg") {
					return nil, fmt.Errorf("file is not an SVG image")
				}
				rootSeen = true
			} else if rootClosed {
				return nil, fmt.Errorf("invalid SVG structure")
			} else if !staticSVGElements[item.Name.Local] || (item.Name.Space != "" && item.Name.Space != "http://www.w3.org/2000/svg") {
				skipped = 1
				continue
			}
			attrs, attrErr := svgAttributes(item, len(stack) == 0)
			if attrErr != nil {
				return nil, attrErr
			}
			clean := xml.StartElement{Name: xml.Name{Local: item.Name.Local}, Attr: attrs}
			if err = encoder.EncodeToken(clean); err != nil {
				return nil, err
			}
			stack = append(stack, item.Name.Local)
		case xml.EndElement:
			if skipped > 0 {
				skipped--
				depth--
				continue
			}
			if len(stack) == 0 {
				return nil, fmt.Errorf("invalid SVG structure")
			}
			name := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if err = encoder.EncodeToken(xml.EndElement{Name: xml.Name{Local: name}}); err != nil {
				return nil, err
			}
			depth--
			if len(stack) == 0 {
				rootClosed = true
			}
		case xml.CharData:
			if rootClosed && strings.TrimSpace(string(item)) != "" {
				return nil, fmt.Errorf("invalid SVG structure")
			}
			if skipped == 0 && len(stack) > 0 && (stack[len(stack)-1] == "text" || stack[len(stack)-1] == "tspan") {
				if err = encoder.EncodeToken(item); err != nil {
					return nil, err
				}
			}
		}
	}
	if !rootSeen || !rootClosed || depth != 0 {
		return nil, fmt.Errorf("invalid SVG structure")
	}
	if err := encoder.Flush(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
