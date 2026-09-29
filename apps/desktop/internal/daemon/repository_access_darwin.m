#import <Foundation/Foundation.h>
char *openadeDirectoryBookmark(const char *path){@autoreleasepool{
 NSURL *url=[NSURL fileURLWithPath:[NSString stringWithUTF8String:path] isDirectory:YES];NSError *error=nil;
 NSData *data=[url bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope includingResourceValuesForKeys:nil relativeToURL:nil error:&error];
 return data?strdup([data base64EncodedStringWithOptions:0].UTF8String):NULL;
}}
int openadeGrantDirectory(const char *bookmark,const char *path){@autoreleasepool{
 static NSMutableDictionary *roots;@synchronized([NSURL class]){
  NSString *expected=[[NSString stringWithUTF8String:path] stringByStandardizingPath];if(roots[expected])return 1;
  NSData *data=[[[NSData alloc]initWithBase64EncodedString:[NSString stringWithUTF8String:bookmark] options:0]autorelease];BOOL stale=NO;NSError *error=nil;
  NSURL *url=[NSURL URLByResolvingBookmarkData:data options:NSURLBookmarkResolutionWithSecurityScope|NSURLBookmarkResolutionWithoutUI|NSURLBookmarkResolutionWithoutMounting relativeToURL:nil bookmarkDataIsStale:&stale error:&error];
  if(!url||stale||![url.path.stringByStandardizingPath isEqualToString:expected])return 0;
  if(![url startAccessingSecurityScopedResource])return 0;
  if(!roots)roots=[[NSMutableDictionary alloc]init];roots[expected]=url;return 1;
 }
}}
