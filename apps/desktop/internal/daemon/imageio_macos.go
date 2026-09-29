//go:build darwin && cgo

package daemon

/*
#cgo LDFLAGS: -framework AppKit -framework CoreFoundation -framework CoreGraphics -framework ImageIO
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>
#include <stdlib.h>
#include <string.h>

static int openade_type_matches(CFStringRef actual, int kind) {
    if (!actual) return 0;
    if (kind == 2) return CFEqual(actual, CFSTR("public.avif")) || CFEqual(actual, CFSTR("public.avis"));
    if (kind == 3) return CFEqual(actual, CFSTR("public.heic")) || CFEqual(actual, CFSTR("public.heif")) || CFEqual(actual, CFSTR("public.heics"));
    return 0;
}

// Return a static PNG from Image I/O. Type and source dimensions are checked
// before the bounded thumbnail is decoded. The caller owns *out on success.
static int openade_image_to_png(const void *input, size_t length, int kind,
                                void **out, size_t *out_length) {
    int result = 1;
    CFDataRef data = NULL;
    CGImageSourceRef source = NULL;
    CFDictionaryRef properties = NULL;
    CFDictionaryRef options = NULL;
    CGImageRef image = NULL;
    CFMutableDataRef png = NULL;
    CGImageDestinationRef destination = NULL;
    *out = NULL;
    *out_length = 0;
    if (!input || !length || length > 24 * 1024 * 1024) return 1;
    data = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)input, (CFIndex)length);
    if (!data) goto cleanup;
    source = CGImageSourceCreateWithData(data, NULL);
    if (!source || CGImageSourceGetCount(source) == 0 ||
        !openade_type_matches(CGImageSourceGetType(source), kind)) goto cleanup;
    properties = CGImageSourceCopyPropertiesAtIndex(source, 0, NULL);
    if (!properties) goto cleanup;
    CFNumberRef width_value = CFDictionaryGetValue(properties, kCGImagePropertyPixelWidth);
    CFNumberRef height_value = CFDictionaryGetValue(properties, kCGImagePropertyPixelHeight);
    double width = 0, height = 0;
    if (!width_value || !height_value ||
        CFGetTypeID(width_value) != CFNumberGetTypeID() ||
        CFGetTypeID(height_value) != CFNumberGetTypeID() ||
        !CFNumberGetValue(width_value, kCFNumberDoubleType, &width) ||
        !CFNumberGetValue(height_value, kCFNumberDoubleType, &height) ||
        width <= 0 || height <= 0 || width > 16384 || height > 16384 ||
        width * height > 64000000) { result = 2; goto cleanup; }

    const void *keys[] = {kCGImageSourceCreateThumbnailFromImageAlways,
                          kCGImageSourceThumbnailMaxPixelSize,
                          kCGImageSourceShouldCacheImmediately};
    int side = 4096;
    CFNumberRef maximum = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &side);
    if (!maximum) goto cleanup;
    const void *values[] = {kCFBooleanTrue, maximum, kCFBooleanFalse};
    options = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 3,
                                 &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFRelease(maximum);
    if (!options) goto cleanup;
    image = CGImageSourceCreateThumbnailAtIndex(source, 0, options);
    if (!image || CGImageGetWidth(image) == 0 || CGImageGetHeight(image) == 0 ||
        CGImageGetWidth(image) > 4096 || CGImageGetHeight(image) > 4096) {
        result = 3; goto cleanup;
    }
    png = CFDataCreateMutable(kCFAllocatorDefault, 0);
    if (!png) goto cleanup;
    destination = CGImageDestinationCreateWithData(png, CFSTR("public.png"), 1, NULL);
    if (!destination) goto cleanup;
    CGImageDestinationAddImage(destination, image, NULL);
    if (!CGImageDestinationFinalize(destination)) { result = 4; goto cleanup; }
    if (CFDataGetLength(png) <= 0 || CFDataGetLength(png) > 24 * 1024 * 1024) {
        result = 5; goto cleanup;
    }
    *out_length = (size_t)CFDataGetLength(png);
    *out = malloc(*out_length);
    if (!*out) { *out_length = 0; result = 4; goto cleanup; }
    memcpy(*out, CFDataGetBytePtr(png), *out_length);
    result = 0;
cleanup:
    if (destination) CFRelease(destination);
    if (png) CFRelease(png);
    if (image) CGImageRelease(image);
    if (options) CFRelease(options);
    if (properties) CFRelease(properties);
    if (source) CFRelease(source);
    if (data) CFRelease(data);
    return result;
}

int openade_svg_to_png(const void *input, size_t length, void **out, size_t *out_length);
*/
import "C"

import (
	"fmt"
	"unsafe"
)

func systemImagePNG(format string, data []byte) ([]byte, error) {
	if len(data) == 0 || len(data) > maxAttachmentBytes {
		return nil, fmt.Errorf("image exceeds 24 MiB")
	}
	kind := C.int(0)
	switch format {
	case "svg":
		kind = 1
	case "avif":
		kind = 2
	case "heic":
		kind = 3
	default:
		return nil, fmt.Errorf("unsupported native image format")
	}
	var output unsafe.Pointer
	var length C.size_t
	code := C.int(0)
	if format == "svg" {
		code = C.openade_svg_to_png(unsafe.Pointer(&data[0]), C.size_t(len(data)), &output, &length)
	} else {
		code = C.openade_image_to_png(unsafe.Pointer(&data[0]), C.size_t(len(data)), kind, &output, &length)
	}
	if code != 0 {
		return nil, fmt.Errorf("macOS could not decode %s within the image limits (code %d)", format, int(code))
	}
	defer C.free(output)
	return C.GoBytes(output, C.int(length)), nil
}
