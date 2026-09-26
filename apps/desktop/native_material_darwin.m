// macOS material recipe adapted from Apache-2.0 GPUI macOS window rendering.
// Copyright 2022-2025 Zed Industries, Inc. Modified for OpenADE/Wails in 2026.
#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>

static void normalizeFrostLayer(CALayer *layer) {
 layer.backgroundColor = nil;
 if ([NSStringFromClass(layer.class) isEqualToString:@"CAChameleonLayer"]) { layer.hidden = YES; return; }
 // AppKit owns these layers. Keep its backdrop sampling while removing the
 // stock tint/saturation; leave unfamiliar filters intact on future systems.
 @try {
  NSMutableArray *filters = [NSMutableArray array];
  for (id filter in layer.filters) {
   NSString *name = [filter description];
   if ([name rangeOfString:@"Saturat" options:NSCaseInsensitiveSearch].location != NSNotFound) continue;
   if ([name rangeOfString:@"Blur" options:NSCaseInsensitiveSearch].location != NSNotFound) [filter setValue:@60.0 forKey:@"inputRadius"];
   [filters addObject:filter];
  }
  if (layer.filters) layer.filters = filters;
 } @catch (NSException *exception) { /* Retain AppKit's safe material fallback. */ }
 for (CALayer *child in layer.sublayers) normalizeFrostLayer(child);
}
@interface OpenADEFrostView : NSVisualEffectView
@end
@implementation OpenADEFrostView
- (void)updateLayer {
 [super updateLayer];
 if (self.layer) { normalizeFrostLayer(self.layer); self.layer.backgroundColor = NSColor.blackColor.CGColor; }
}
@end
void openadeAppearance(int appearance,int frosted) {
 dispatch_async(dispatch_get_main_queue(), ^{
  for (NSWindow *window in NSApp.windows) {
   if (![window.title isEqualToString:@"OpenADE"]) continue;
   window.appearance = appearance==1 ? [NSAppearance appearanceNamed:NSAppearanceNameAqua] : appearance==2 ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua] : nil;
   window.opaque = !frosted;
   window.backgroundColor = [NSColor colorWithSRGBRed:0 green:0 blue:0 alpha:frosted ? 0.0001 : 1.0];
   OpenADEFrostView *frost = nil;
   for (NSView *view in [[window.contentView.subviews copy] autorelease]) {
    if ([view isKindOfClass:OpenADEFrostView.class]) frost = (OpenADEFrostView*)view;
    else if ([view isKindOfClass:NSVisualEffectView.class]) [view removeFromSuperview];
   }
   if (!frost && frosted) {
    frost = [[[OpenADEFrostView alloc] initWithFrame:window.contentView.bounds] autorelease];
    frost.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    frost.material = NSVisualEffectMaterialUnderWindowBackground;
    frost.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    frost.state = NSVisualEffectStateActive;
    [window.contentView addSubview:frost positioned:NSWindowBelow relativeTo:nil];
   }
   frost.hidden = !frosted;
   frost.needsDisplay = YES;
  }
 });
}
