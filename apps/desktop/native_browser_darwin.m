#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

extern void openadeBrowserChanged(char *tab,char *url,char *title,int back,int forward);
extern void openadeBrowserNewTab(char *tab,char *url);
extern NSView *openadeContentHost(NSWindow *window);

static NSMutableDictionary<NSString *, WKWebView *> *browserViews;
static NSMutableDictionary<NSString *, id> *browserDelegates;
static WKWebsiteDataStore *browserDataStore;

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
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {browserState(_tab,view);}
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
   } else if(action==1)[view goBack];
   else if(action==2)[view goForward];
   else if(action==3)[view reload];
   else if(action==4)view.hidden=YES;
   else if(action==5) {
    for(NSString *key in browserViews)browserViews[key].hidden=![key isEqualToString:identifier];
   }
  }
  [identifier release];
 });
}
