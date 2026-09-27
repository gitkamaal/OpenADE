#import <Cocoa/Cocoa.h>
#import <CoreText/CoreText.h>
#import <objc/runtime.h>
#include <string.h>
#include <math.h>

static NSString *cachedFonts;
char *openadeFontCatalog(void) {
 __block char *result=NULL;
 void (^read)(void)=^{@autoreleasepool{
  if(cachedFonts){result=strdup(cachedFonts.UTF8String);return;}
  NSMutableArray *rows=[NSMutableArray array];NSFontManager *manager=[NSFontManager sharedFontManager];
  NSArray *families=[manager.availableFontFamilies sortedArrayUsingSelector:@selector(localizedCaseInsensitiveCompare:)];
  for(NSString *family in families){if(family.length>200||[family rangeOfCharacterFromSet:[NSCharacterSet controlCharacterSet]].location!=NSNotFound)continue;
   NSFont *font=[manager fontWithFamily:family traits:0 weight:5 size:13];if(!font)continue;
   BOOL mono=YES,latin=NO;
   for(NSArray *member in [manager availableMembersOfFontFamily:family]){if(member.count<1)continue;CTFontRef face=CTFontCreateWithName((CFStringRef)member[0],13,NULL);if(!face)continue;UniChar chars[4]={'i','m','W','0'};CGGlyph glyphs[4]={0};CTFontGetGlyphsForCharacters(face,chars,glyphs,4);if(!glyphs[1]){CFRelease(face);continue;}latin=YES;CGSize advance[4];CTFontGetAdvancesForGlyphs(face,kCTFontOrientationHorizontal,glyphs,advance,4);CGFloat min=INFINITY,max=0;for(int i=0;i<4;i++){if(!glyphs[i]){mono=NO;break;}min=fmin(min,advance[i].width);max=fmax(max,advance[i].width);}if(min<=0||max-min>min*.01)mono=NO;CFRelease(face);}
   if(!latin)continue;
   [rows addObject:@{@"family":family,@"monospace":@(mono)}];if(rows.count>=4096)break;
  }
  NSData *json=[NSJSONSerialization dataWithJSONObject:rows options:0 error:nil];NSString *text=[[[NSString alloc]initWithData:json encoding:NSUTF8StringEncoding]autorelease];cachedFonts=[text copy];result=strdup(text.UTF8String?:"[]");
 }};
 if([NSThread isMainThread])read();else dispatch_sync(dispatch_get_main_queue(),read);return result;
}

@interface OpenADEGeometry : NSObject
@property(nonatomic,retain) NSString *key;
@property(nonatomic,assign) NSWindow *window;
- (void)save:(NSNotification*)notification;
@end
@implementation OpenADEGeometry
- (void)save:(NSNotification*)notification{if(!self.window||self.window.isMiniaturized)return;NSRect frame=self.window.frame;if(frame.size.width<640||frame.size.height<400)return;[[NSUserDefaults standardUserDefaults]setObject:NSStringFromRect(frame) forKey:self.key];}
- (void)dealloc{[[NSNotificationCenter defaultCenter]removeObserver:self];[_key release];[super dealloc];}
@end
static const char geometryKey;
void openadeRestoreGeometry(const char *profile){NSString *key=[[NSString alloc]initWithFormat:@"OpenADE.WindowGeometry.%s",profile];dispatch_async(dispatch_get_main_queue(),^{
 NSWindow *window=nil;for(NSWindow *candidate in NSApp.windows){if([candidate.title isEqualToString:@"OpenADE"]){window=candidate;break;}}if(!window){[key release];return;}
 if(objc_getAssociatedObject(window,&geometryKey)){[key release];return;}
 NSString *saved=[[NSUserDefaults standardUserDefaults]stringForKey:key];if(saved){NSRect frame=NSRectFromString(saved);BOOL valid=isfinite(frame.origin.x)&&isfinite(frame.origin.y)&&isfinite(frame.size.width)&&isfinite(frame.size.height)&&frame.size.width>=640&&frame.size.height>=400;
  if(valid){NSScreen *screen=nil;CGFloat overlap=0;for(NSScreen *candidate in NSScreen.screens){NSRect intersection=NSIntersectionRect(frame,candidate.visibleFrame);CGFloat area=intersection.size.width*intersection.size.height;if(area>overlap){overlap=area;screen=candidate;}}if(!screen)screen=NSScreen.mainScreen;
   NSRect visible=screen.visibleFrame;frame.size.width=fmin(frame.size.width,visible.size.width);frame.size.height=fmin(frame.size.height,visible.size.height);frame.origin.x=fmax(visible.origin.x,fmin(frame.origin.x,NSMaxX(visible)-frame.size.width));frame.origin.y=fmax(visible.origin.y,fmin(frame.origin.y,NSMaxY(visible)-frame.size.height));[window setFrame:frame display:YES];
  }
 }
 OpenADEGeometry *observer=[[OpenADEGeometry alloc]init];observer.key=key;observer.window=window;objc_setAssociatedObject(window,&geometryKey,observer,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
 for(NSString *name in @[NSWindowDidMoveNotification,NSWindowDidResizeNotification,NSWindowWillCloseNotification])[[NSNotificationCenter defaultCenter]addObserver:observer selector:@selector(save:) name:name object:window];[observer release];[key release];
});}
