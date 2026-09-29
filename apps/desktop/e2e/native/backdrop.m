// Native visual E2E fixture only. Copy to the desktop package while building
// a verification binary, then remove it before building the delivered app.
// No private APIs, window alpha changes, wallpaper edits or input automation.
#import <Cocoa/Cocoa.h>

@interface OpenADEContrastBackdrop : NSView
@end
@implementation OpenADEContrastBackdrop
- (void)drawRect:(NSRect)rect {
 CGFloat w=self.bounds.size.width,h=self.bounds.size.height;
 NSArray *colors=@[[NSColor colorWithSRGBRed:1 green:.25 blue:.04 alpha:1],
 [NSColor colorWithSRGBRed:1 green:.78 blue:.12 alpha:1],
 [NSColor colorWithSRGBRed:0 green:.75 blue:.85 alpha:1],
 [NSColor colorWithSRGBRed:.12 green:.25 blue:1 alpha:1]];
 for (int i=0;i<4;i++){[colors[i] setFill];NSRectFill(NSMakeRect(w*i/4,0,w/4,h));}
 [NSColor.whiteColor setFill];NSRectFill(NSMakeRect(0,h*.6,w,h*.16));
 [NSColor.blackColor setFill];NSRectFill(NSMakeRect(0,h*.2,w,h*.16));
}
@end

static NSWindow *backdrop;
__attribute__((constructor)) static void prepareVisualE2E(void) {
 if (!getenv("OPENADE_VISUAL_E2E")) return;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,2*NSEC_PER_SEC),dispatch_get_main_queue(),^{
   NSWindow *main=nil;
   for(NSWindow *candidate in NSApp.windows)if([candidate.title isEqualToString:@"OpenADE"])main=candidate;
   if(!main)return;
   if (strcmp(getenv("OPENADE_VISUAL_E2E"),"content")==0) {
    // Window-only captures omit other windows. This alternate fixture checks
    // real WebKit alpha over a native sibling, not desktop transmission.
    NSView *root=main.contentView;
    NSView *bands=[[[OpenADEContrastBackdrop alloc]initWithFrame:root.bounds]autorelease];
    bands.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    [root addSubview:bands positioned:NSWindowBelow relativeTo:nil];
    fprintf(stderr,"Native content-alpha fixture installed (not desktop capture)\n");
    return;
   }
   backdrop=[[NSWindow alloc]initWithContentRect:main.screen.visibleFrame styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
   backdrop.title=@"OpenADE visual E2E backdrop";
   backdrop.contentView=[[[OpenADEContrastBackdrop alloc]initWithFrame:backdrop.contentView.bounds]autorelease];
   backdrop.releasedWhenClosed=NO;
   [backdrop orderWindow:NSWindowBelow relativeTo:main.windowNumber];
   [main makeKeyAndOrderFront:nil];
   fprintf(stderr,"Native E2E backdrop installed behind regular OpenADE window\n");
  });
}
