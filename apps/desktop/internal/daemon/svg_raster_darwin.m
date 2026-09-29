#import <AppKit/AppKit.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

// Only sanitizedWorkspaceSVG output reaches this renderer. SVG is rasterized
// into a bounded PNG before its immutable attachment path reaches a provider.
int openade_svg_to_png(const void *input, size_t length, void **out, size_t *out_length) {
    *out = NULL;
    *out_length = 0;
    if (!input || !length || length > 8 * 1024 * 1024) return 1;
    @autoreleasepool {
        NSData *data = [NSData dataWithBytes:input length:length];
        NSImage *image = [[[NSImage alloc] initWithData:data] autorelease];
        if (!image) return 1;
        NSSize size = image.size;
        if (!isfinite(size.width) || !isfinite(size.height) || size.width <= 0 ||
            size.height <= 0 || size.width > 4096 || size.height > 4096 ||
            size.width * size.height > 4000000) return 2;
        NSInteger width = (NSInteger)ceil(size.width);
        NSInteger height = (NSInteger)ceil(size.height);
        NSBitmapImageRep *bitmap = [[[NSBitmapImageRep alloc]
            initWithBitmapDataPlanes:NULL pixelsWide:width pixelsHigh:height
            bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
            colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0] autorelease];
        if (!bitmap) return 3;
        NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
        if (!context) return 3;
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:context];
        [image drawInRect:NSMakeRect(0, 0, width, height)
                 fromRect:NSZeroRect operation:NSCompositingOperationCopy
                 fraction:1.0 respectFlipped:NO hints:nil];
        [context flushGraphics];
        [NSGraphicsContext restoreGraphicsState];
        NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        if (!png || png.length == 0 || png.length > 24 * 1024 * 1024) return 4;
        *out_length = (size_t)png.length;
        *out = malloc(*out_length);
        if (!*out) { *out_length = 0; return 4; }
        memcpy(*out, png.bytes, *out_length);
        return 0;
    }
}
