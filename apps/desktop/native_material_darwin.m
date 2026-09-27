// Original bridge adapted from Apache-2.0 GPUI macOS window rendering.
// Copyright 2022-2025 Zed Industries, Inc. Modified for OpenADE/Wails in 2026.
// Private layer/filter manipulation has been replaced with public AppKit APIs.
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

extern void openadeAppearanceChanged(int status);
// Only public AppKit APIs. Never change window/content alpha or private filters.
@interface OpenADEMaterial : NSObject
@property(nonatomic, assign) NSWindow *window;
@property(nonatomic, retain) NSView *host;
@property(nonatomic, retain) NSView *effect;
@property(nonatomic, retain) NSVisualEffectView *backdrop;
@property(nonatomic) int scheme;
@property(nonatomic) int requested;
@property(nonatomic) int status;
- (void)apply;
@end

static const char materialKey;
static NSVisualEffectMaterial desktopMaterial(void) {
 if (@available(macOS 10.14, *)) return NSVisualEffectMaterialUnderWindowBackground;
 return NSVisualEffectMaterialSidebar;
}
NSView *openadeContentHost(NSWindow *window) {
 OpenADEMaterial *material = objc_getAssociatedObject(window, &materialKey);
 return material.host ?: window.contentView;
}

@implementation OpenADEMaterial
- (instancetype)init {
 if ((self = [super init])) {
  [[[NSWorkspace sharedWorkspace] notificationCenter] addObserver:self selector:@selector(accessibilityChanged:) name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
 }
 return self;
}
- (void)dealloc {
 [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:self];
 [_host release]; [_effect release]; [_backdrop release]; [super dealloc];
}
- (void)accessibilityChanged:(NSNotification *)notification {
 if (!NSThread.isMainThread) {dispatch_async(dispatch_get_main_queue(), ^{[self accessibilityChanged:notification];}); return;}
 [self apply]; openadeAppearanceChanged(self.status);
}
- (void)apply {
 NSWindow *window = self.window;
 NSAppearance *appearance = nil;
 if (self.scheme == 1) appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
 if (@available(macOS 10.14, *)) {
  if (self.scheme == 2) appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
 }
 window.appearance = appearance;
 NSWorkspace *workspace = [NSWorkspace sharedWorkspace];
 self.status = self.requested;
 if (workspace.accessibilityDisplayShouldIncreaseContrast) self.status = 4;
 else if (workspace.accessibilityDisplayShouldReduceTransparency) self.status = 3;
 BOOL liquid = NO;
 #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
 if (@available(macOS 26.0, *)) liquid = self.status == 2 && NSClassFromString(@"NSGlassEffectView") != nil;
 #endif
 if (self.status == 2 && !liquid) self.status = 5;
 BOOL clear = self.status == 6;
 BOOL translucent = clear || self.status == 1 || self.status == 2 || self.status == 5;
 window.opaque = !translucent;
 window.backgroundColor = translucent ? NSColor.clearColor : NSColor.windowBackgroundColor;
 NSView *root = window.contentView;
 if (!self.host) {
  self.host = [[[NSView alloc] initWithFrame:root.bounds] autorelease];
  self.host.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  // Wails' initial vibrancy view is replaced, while its webview is retained.
  for (NSView *view in [[root.subviews copy] autorelease]) {
   if ([view isKindOfClass:NSVisualEffectView.class]) [view removeFromSuperview];
   else [self.host addSubview:view];
  }
  [root addSubview:self.host];
 }
 // Reuse the material while changing palettes; rebuild only when its type changes.
 NSString *kind = !translucent ? @"solid" : clear ? @"clear" : liquid ? @"liquid" : @"frosted";
 // Clear intentionally has no material view: desktop pixels pass through the
 // transparent window and WebKit canvas. Only CSS palette washes remain.
 if (clear || ![self.effect.identifier isEqualToString:kind]) {
  [self.effect removeFromSuperview]; self.effect = nil;
  [self.backdrop removeFromSuperview]; self.backdrop = nil;
  if (translucent && !clear) {
   #if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
   if (@available(macOS 26.0, *)) {
    if (liquid) {
     NSGlassEffectView *glass = [[[NSGlassEffectView alloc] initWithFrame:root.bounds] autorelease];
     glass.style = NSGlassEffectViewStyleClear;
     // Glass samples within this window. A public behind-window material
     // supplies the actual desktop before glass adds its optical edge.
     NSVisualEffectView *backdrop = [[[NSVisualEffectView alloc] initWithFrame:root.bounds] autorelease];
     backdrop.material = desktopMaterial();
     backdrop.blendingMode = NSVisualEffectBlendingModeBehindWindow;
     backdrop.state = NSVisualEffectStateActive;
     // Thin only the background material, never the window or WebKit content.
     backdrop.alphaValue = 0.40;
     backdrop.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
     self.backdrop = backdrop;
     glass.cornerRadius = 10;
     // The webview stays in a stable sibling above this native background.
     // Only this empty effect content belongs to glass; no arbitrary children.
     glass.contentView = [[[NSView alloc] initWithFrame:glass.bounds] autorelease];
     self.effect = glass;
    }
   }
   #endif
   if (!self.effect) {
    NSVisualEffectView *frost = [[[NSVisualEffectView alloc] initWithFrame:root.bounds] autorelease];
    frost.material = desktopMaterial();
    frost.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    frost.state = NSVisualEffectStateActive;
    frost.alphaValue = 0.40;
    self.effect = frost;
   }
   self.effect.identifier = kind;
   self.effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
   [root addSubview:self.effect positioned:NSWindowBelow relativeTo:nil];
   if (self.backdrop) [root addSubview:self.backdrop positioned:NSWindowBelow relativeTo:self.effect];
  }
 }
 self.host.frame = root.bounds;
 self.host.hidden = NO;
 self.host.needsDisplay = YES;
}
@end

int openadeAppearance(int scheme, int material) {
 __block int status = 0;
 void (^apply)(void) = ^{
  for (NSWindow *window in NSApp.windows) {
   if (![window.title isEqualToString:@"OpenADE"]) continue;
   OpenADEMaterial *controller = objc_getAssociatedObject(window, &materialKey);
   if (!controller) {
    controller = [[[OpenADEMaterial alloc] init] autorelease];
    controller.window = window;
    objc_setAssociatedObject(window, &materialKey, controller, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
   }
   controller.scheme = scheme; controller.requested = material;
   [controller apply]; status = controller.status;
  }
 };
 if (NSThread.isMainThread) apply(); else dispatch_sync(dispatch_get_main_queue(), apply);
 return status;
}
