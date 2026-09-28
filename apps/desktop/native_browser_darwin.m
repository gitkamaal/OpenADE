#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <ImageIO/ImageIO.h>
#include <stdlib.h>
#include <string.h>

extern void openadeBrowserChanged(char *tab,char *url,char *title,int back,int forward);
extern void openadeBrowserNewTab(char *tab,char *url);
extern void openadeBrowserFavicon(char *tab,char *page,char *url);
extern void openadeBrowserKey(char *tab,char *combo);
extern NSView *openadeContentHost(NSWindow *window);

// Image I/O validates and downsizes a fetched raster favicon before its PNG
// bytes cross into the Wails renderer. The caller frees *output on success.
int openadeBrowserIconPNG(const void *input,size_t length,void **output,size_t *outputLength) {
 *output=NULL;*outputLength=0;
 if(!input||length==0||length>1024*1024)return 1;
 int result=1;
 CFDataRef bytes=CFDataCreate(kCFAllocatorDefault,input,(CFIndex)length);
 CGImageSourceRef source=bytes?CGImageSourceCreateWithData(bytes,NULL):NULL;
 CFDictionaryRef properties=NULL,options=NULL;
 CGImageRef image=NULL;
 CFMutableDataRef png=NULL;
 CGImageDestinationRef destination=NULL;
 if(!source||CGImageSourceGetCount(source)==0)goto cleanup;
 CFStringRef kind=CGImageSourceGetType(source);
 if(!kind||!(CFEqual(kind,CFSTR("public.png"))||CFEqual(kind,CFSTR("public.jpeg"))||
             CFEqual(kind,CFSTR("com.compuserve.gif"))||CFEqual(kind,CFSTR("com.microsoft.ico"))||
             CFEqual(kind,CFSTR("org.webmproject.webp"))))goto cleanup;
 properties=CGImageSourceCopyPropertiesAtIndex(source,0,NULL);
 if(!properties)goto cleanup;
 CFNumberRef widthValue=CFDictionaryGetValue(properties,kCGImagePropertyPixelWidth);
 CFNumberRef heightValue=CFDictionaryGetValue(properties,kCGImagePropertyPixelHeight);
 double width=0,height=0;
 if(!widthValue||!heightValue||CFGetTypeID(widthValue)!=CFNumberGetTypeID()||
    CFGetTypeID(heightValue)!=CFNumberGetTypeID()||
    !CFNumberGetValue(widthValue,kCFNumberDoubleType,&width)||
    !CFNumberGetValue(heightValue,kCFNumberDoubleType,&height)||
    width<=0||height<=0||width>1024||height>1024||width*height*4>8*1024*1024)goto cleanup;
 int side=32;
 CFNumberRef maxSide=CFNumberCreate(kCFAllocatorDefault,kCFNumberIntType,&side);
 if(!maxSide)goto cleanup;
 const void *keys[]={kCGImageSourceCreateThumbnailFromImageAlways,kCGImageSourceThumbnailMaxPixelSize,kCGImageSourceShouldCacheImmediately};
 const void *values[]={kCFBooleanTrue,maxSide,kCFBooleanFalse};
 options=CFDictionaryCreate(kCFAllocatorDefault,keys,values,3,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 CFRelease(maxSide);
 if(!options)goto cleanup;
 image=CGImageSourceCreateThumbnailAtIndex(source,0,options);
 if(!image||CGImageGetWidth(image)==0||CGImageGetHeight(image)==0||
    CGImageGetWidth(image)>32||CGImageGetHeight(image)>32)goto cleanup;
 png=CFDataCreateMutable(kCFAllocatorDefault,0);
 if(!png)goto cleanup;
 destination=CGImageDestinationCreateWithData(png,CFSTR("public.png"),1,NULL);
 if(!destination)goto cleanup;
 CGImageDestinationAddImage(destination,image,NULL);
 if(!CGImageDestinationFinalize(destination)||CFDataGetLength(png)<=0||CFDataGetLength(png)>1024*1024)goto cleanup;
 *outputLength=(size_t)CFDataGetLength(png);
 *output=malloc(*outputLength);
 if(!*output){*outputLength=0;goto cleanup;}
 memcpy(*output,CFDataGetBytePtr(png),*outputLength);
 result=0;
cleanup:
 if(destination)CFRelease(destination);
 if(png)CFRelease(png);
 if(image)CGImageRelease(image);
 if(options)CFRelease(options);
 if(properties)CFRelease(properties);
 if(source)CFRelease(source);
 if(bytes)CFRelease(bytes);
 return result;
}

static NSMutableDictionary<NSString *, WKWebView *> *browserViews;
static NSMutableDictionary<NSString *, id> *browserDelegates;
static WKWebsiteDataStore *browserDataStore;
static NSSet<NSString *> *browserShortcuts;
static id browserKeyMonitor;

static NSString *browserKeyCombo(NSEvent *event) {
 NSEventModifierFlags mods=event.modifierFlags;
 NSString *key=nil;
 switch(event.keyCode) {
  case 48:key=@"tab";break;
  case 123:key=@"arrowleft";break;
  case 124:key=@"arrowright";break;
  case 125:key=@"arrowdown";break;
  case 126:key=@"arrowup";break;
  default:key=event.charactersIgnoringModifiers.lowercaseString;break;
 }
 if(!key.length||key.length>20)return nil;
 NSMutableString *combo=[NSMutableString string];
 if(mods&NSEventModifierFlagCommand)[combo appendString:@"mod+"];
 if(mods&NSEventModifierFlagControl)[combo appendString:@"ctrl+"];
 if(mods&NSEventModifierFlagOption)[combo appendString:@"alt+"];
 if(mods&NSEventModifierFlagShift)[combo appendString:@"shift+"];
 [combo appendString:key];
 return combo;
}

void openadeBrowserSetShortcuts(const char *json) {
 NSString *value=json?[NSString stringWithUTF8String:json]:nil;
 dispatch_async(dispatch_get_main_queue(),^{
  NSData *data=[value dataUsingEncoding:NSUTF8StringEncoding];
  NSArray *items=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL]:nil;
  if(![items isKindOfClass:[NSArray class]])return;
  NSMutableSet *next=[NSMutableSet set];
  for(id item in items)if([item isKindOfClass:[NSString class]]&&[item length]<=64)[next addObject:item];
  [browserShortcuts release];browserShortcuts=[next copy];
 });
}

static void browserInstallKeyMonitor(void) {
 if(browserKeyMonitor)return;
 browserKeyMonitor=[[NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event){
  NSWindow *window=event.window;
  NSResponder *responder=window.firstResponder;
  if(![responder isKindOfClass:[NSView class]])return event;
  NSString *tab=nil;
  for(NSString *identifier in browserViews) {
   WKWebView *view=browserViews[identifier];
   if(!view.hidden&&view.window==window&&[(NSView *)responder isDescendantOf:view]){tab=identifier;break;}
  }
  if(!tab)return event;
  NSString *combo=browserKeyCombo(event);
  static NSSet<NSString *> *browserKeys;
  if(!browserKeys)browserKeys=[[NSSet alloc]initWithArray:@[@"mod+l",@"mod+t",@"mod+w",@"mod+[",@"mod+]",@"mod+shift+r",@"mod+k",@"mod+,"]];
  if(!combo||(![browserKeys containsObject:combo]&&![browserShortcuts containsObject:combo]))return event;
  openadeBrowserKey((char *)tab.UTF8String,(char *)combo.UTF8String);
  return nil;
 }] retain];
}

static BOOL browserAllowed(NSURL *url) {
 NSString *scheme=url.scheme.lowercaseString;
 return (([scheme isEqualToString:@"http"]||[scheme isEqualToString:@"https"])
         &&url.host.length>0&&!url.user.length&&!url.password.length);
}

static NSView *browserHost(void) {
 for(NSWindow *window in NSApp.windows) {
  if([window.title isEqualToString:@"OpenADE"])return openadeContentHost(window);
 }
 return nil;
}

static void browserState(NSString *tab, WKWebView *view) {
 NSString *url=view.URL.absoluteString?:@"";
 NSString *title=view.title?:@"";
 openadeBrowserChanged((char *)tab.UTF8String,(char *)url.UTF8String,(char *)title.UTF8String,view.canGoBack,view.canGoForward);
}

@interface OpenADEBrowserDelegate : NSObject <WKNavigationDelegate, WKUIDelegate> {
 NSString *_tab;
}
- (id)initWithTab:(NSString *)tab;
- (void)observeWebView:(WKWebView *)view;
- (void)stopObservingWebView:(WKWebView *)view;
@end

@implementation OpenADEBrowserDelegate
- (id)initWithTab:(NSString *)tab {
 self=[super init];
 if(self)_tab=[tab copy];
 return self;
}
- (void)dealloc {[_tab release];[super dealloc];}
- (void)observeWebView:(WKWebView *)view {
 for(NSString *key in @[@"URL",@"title",@"canGoBack",@"canGoForward"])
  [view addObserver:self forKeyPath:key options:NSKeyValueObservingOptionNew context:NULL];
}
- (void)stopObservingWebView:(WKWebView *)view {
 for(NSString *key in @[@"URL",@"title",@"canGoBack",@"canGoForward"])
  [view removeObserver:self forKeyPath:key];
}
- (void)observeValueForKeyPath:(NSString *)key ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
 if([object isKindOfClass:[WKWebView class]])browserState(_tab,(WKWebView *)object);
 else [super observeValueForKeyPath:key ofObject:object change:change context:context];
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
 handler(browserAllowed(action.request.URL)?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationResponse:(WKNavigationResponse *)response decisionHandler:(void (^)(WKNavigationResponsePolicy))handler {
 // Zeron deliberately cancels downloads. A non-displayable file stays in the
 // user's default browser rather than becoming an implicit local download.
 handler(response.canShowMIMEType?WKNavigationResponsePolicyAllow:WKNavigationResponsePolicyCancel);
}
- (void)webView:(WKWebView *)view didCommitNavigation:(WKNavigation *)navigation {browserState(_tab,view);}
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
 browserState(_tab,view);
 NSString *page=[view.URL.absoluteString copy];
 NSString *tab=[_tab copy];
 if(page.length>0&&browserAllowed(view.URL)) {
  [view evaluateJavaScript:@"(() => { const link = document.querySelector('link[rel~=icon]'); return link ? link.href : new URL('/favicon.ico', location.href).href; })()" completionHandler:^(id value,NSError *error){
   if(!error&&[value isKindOfClass:[NSString class]])
    openadeBrowserFavicon((char *)tab.UTF8String,(char *)page.UTF8String,(char *)[(NSString *)value UTF8String]);
  }];
 }
 [page release];[tab release];
}
- (WKWebView *)webView:(WKWebView *)view createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
 NSURL *url=action.request.URL;
 if(browserAllowed(url))openadeBrowserNewTab((char *)_tab.UTF8String,(char *)url.absoluteString.UTF8String);
 return nil;
}
@end

static void browserEnsureStore(void) {
 if(!browserViews)browserViews=[[NSMutableDictionary alloc]init];
 if(!browserDelegates)browserDelegates=[[NSMutableDictionary alloc]init];
 if(!browserDataStore)browserDataStore=[[WKWebsiteDataStore nonPersistentDataStore] retain];
 browserInstallKeyMonitor();
}

static void browserPlace(NSString *tab, WKWebView *view, double x, double y, double width, double height) {
 NSView *host=browserHost();
 if(!host||width<=0||height<=0)return;
 view.frame=NSMakeRect(x,host.bounds.size.height-y-height,width,height);
 if(view.superview!=host)[host addSubview:view];
 for(NSString *key in browserViews)browserViews[key].hidden=![key isEqualToString:tab];
}

void openadeBrowserOpen(const char *tab,const char *url,double x,double y,double width,double height) {
 NSString *identifier=tab?[[NSString alloc]initWithUTF8String:tab]:nil;
 NSString *address=url?[[NSString alloc]initWithUTF8String:url]:nil;
 dispatch_async(dispatch_get_main_queue(),^{
  if(identifier&&address&&browserAllowed([NSURL URLWithString:address])) {
   browserEnsureStore();
   WKWebView *view=browserViews[identifier];
   BOOL created=view==nil;
   if(created) {
    WKWebViewConfiguration *configuration=[[WKWebViewConfiguration alloc]init];
    configuration.websiteDataStore=browserDataStore;
    if(@available(macOS 10.15,*))configuration.preferences.fraudulentWebsiteWarningEnabled=YES;
    view=[[WKWebView alloc]initWithFrame:NSZeroRect configuration:configuration];
    [configuration release];
    OpenADEBrowserDelegate *delegate=[[OpenADEBrowserDelegate alloc]initWithTab:identifier];
    view.navigationDelegate=delegate;
    view.UIDelegate=delegate;
    [delegate observeWebView:view];
    browserViews[identifier]=view;
    browserDelegates[identifier]=delegate;
    [view release];
    [delegate release];
   }
   browserPlace(identifier,view,x,y,width,height);
   if(created)[view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:address]]];
  }
  [identifier release];[address release];
 });
}

void openadeBrowserNavigate(const char *tab,const char *url) {
 NSString *identifier=tab?[[NSString alloc]initWithUTF8String:tab]:nil;
 NSString *address=url?[[NSString alloc]initWithUTF8String:url]:nil;
 dispatch_async(dispatch_get_main_queue(),^{
  WKWebView *view=browserViews[identifier];
  if(view&&browserAllowed([NSURL URLWithString:address]))[view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:address]]];
  [identifier release];[address release];
 });
}

void openadeBrowserBounds(const char *tab,double x,double y,double width,double height) {
 NSString *identifier=tab?[[NSString alloc]initWithUTF8String:tab]:nil;
 dispatch_async(dispatch_get_main_queue(),^{
  WKWebView *view=browserViews[identifier];
  NSView *host=browserHost();
  if(view&&host&&width>0&&height>0)view.frame=NSMakeRect(x,host.bounds.size.height-y-height,width,height);
  [identifier release];
 });
}

void openadeBrowserAction(const char *tab,int action) {
 NSString *identifier=tab?[[NSString alloc]initWithUTF8String:tab]:nil;
 dispatch_async(dispatch_get_main_queue(),^{
  WKWebView *view=browserViews[identifier];
  if(view) {
   if(action==0) {
    [(OpenADEBrowserDelegate *)browserDelegates[identifier] stopObservingWebView:view];
    [view stopLoading];view.navigationDelegate=nil;view.UIDelegate=nil;
    [view removeFromSuperview];[browserViews removeObjectForKey:identifier];[browserDelegates removeObjectForKey:identifier];
    if(browserViews.count==0&&browserKeyMonitor){[NSEvent removeMonitor:browserKeyMonitor];[browserKeyMonitor release];browserKeyMonitor=nil;}
   } else if(action==1)[view goBack];
   else if(action==2)[view goForward];
   else if(action==3)[view reload];
   else if(action==4)view.hidden=YES;
   else if(action==5) {
    for(NSString *key in browserViews)browserViews[key].hidden=![key isEqualToString:identifier];
    if(view.URL)browserState(identifier,view);
   }
  }
  [identifier release];
 });
}
