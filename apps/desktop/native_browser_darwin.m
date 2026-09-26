
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
extern void openadeBrowserNavigated(char *url,int back,int forward);
static WKWebView *openadeBrowser;
static id openadeBrowserDelegate;
@interface OpenADEBrowserDelegate : NSObject <WKNavigationDelegate>
@end
@implementation OpenADEBrowserDelegate
- (void)webView:(WKWebView*)view decidePolicyForNavigationAction:(WKNavigationAction*)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
 NSString *scheme=action.request.URL.scheme.lowercaseString;
 handler((([scheme isEqualToString:@"http"]||[scheme isEqualToString:@"https"])&&!action.request.URL.user.length&&!action.request.URL.password.length)?WKNavigationActionPolicyAllow:WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView*)view didFinishNavigation:(WKNavigation*)navigation {
 if(view.URL)openadeBrowserNavigated((char*)view.URL.absoluteString.UTF8String,view.canGoBack,view.canGoForward);
}
@end
void openadeBrowserShow(const char *url,double x,double y,double width,double height){
 NSString *address=url?[[NSString alloc]initWithUTF8String:url]:nil;
 dispatch_async(dispatch_get_main_queue(), ^{
  NSWindow *window=nil;for(NSWindow *candidate in NSApp.windows){if([candidate.title isEqualToString:@"OpenADE"]){window=candidate;break;}}
  if(window&&width>0&&height>0){
   if(!openadeBrowser){WKWebViewConfiguration *configuration=[[WKWebViewConfiguration alloc]init];configuration.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];configuration.preferences.fraudulentWebsiteWarningEnabled=YES;openadeBrowser=[[WKWebView alloc]initWithFrame:NSZeroRect configuration:configuration];[configuration release];openadeBrowserDelegate=[[OpenADEBrowserDelegate alloc]init];openadeBrowser.navigationDelegate=openadeBrowserDelegate;}
   NSView *host=window.contentView;openadeBrowser.frame=NSMakeRect(x,host.bounds.size.height-y-height,width,height);
   if(openadeBrowser.superview!=host)[host addSubview:openadeBrowser];
   if(address)[openadeBrowser loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:address]]];
  }
  [address release];
 });
}
void openadeBrowserAction(int action){dispatch_async(dispatch_get_main_queue(),^{
 if(action==0){[openadeBrowser stopLoading];[openadeBrowser removeFromSuperview];[openadeBrowser release];openadeBrowser=nil;[openadeBrowserDelegate release];openadeBrowserDelegate=nil;}
 else if(action==4)openadeBrowser.hidden=YES;else if(action==5)openadeBrowser.hidden=NO;
 else if(action==1)[openadeBrowser goBack];else if(action==2)[openadeBrowser goForward];else if(action==3)[openadeBrowser reload];
});}