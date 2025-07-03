#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
        
        if (!windowList) {
            printf("[]");
            return 0;
        }
        
        NSMutableArray *windows = [NSMutableArray array];
        CFIndex windowCount = CFArrayGetCount(windowList);
        int windowIdCounter = 1;
        
        for (CFIndex i = 0; i < windowCount; i++) {
            CFDictionaryRef windowDict = CFArrayGetValueAtIndex(windowList, i);
            
            CFStringRef ownerName = CFDictionaryGetValue(windowDict, kCGWindowOwnerName);
            CFStringRef windowName = CFDictionaryGetValue(windowDict, kCGWindowName);
            CFDictionaryRef boundsDict = CFDictionaryGetValue(windowDict, kCGWindowBounds);
            CFNumberRef cgWindowIDRef = CFDictionaryGetValue(windowDict, kCGWindowNumber);
            
            if (!ownerName || !windowName || !boundsDict || !cgWindowIDRef) continue;
            
            NSString *ownerStr = (__bridge NSString *)ownerName;
            NSString *windowStr = (__bridge NSString *)windowName;
            
            // Skip windows without names or from system processes (like Swift version)
            if (windowStr.length == 0 || ownerStr.length == 0) continue;
            
            // Extract bounds
            CGRect bounds;
            if (!CGRectMakeWithDictionaryRepresentation(boundsDict, &bounds)) continue;
            
            // Skip windows that are too small (likely not user windows) - same as Swift
            if (bounds.size.width < 50 || bounds.size.height < 50) continue;
            
            // Skip certain system windows - same as Swift
            if ([ownerStr isEqualToString:@"WindowServer"] || 
                [ownerStr isEqualToString:@"Dock"] || 
                [ownerStr isEqualToString:@"SystemUIServer"]) continue;
            
            // Get CGWindowID safely
            UInt32 cgWindowID = 0;
            if (cgWindowIDRef) {
                CFNumberGetValue(cgWindowIDRef, kCFNumberSInt32Type, &cgWindowID);
            }
            
            // Create window info dictionary with safer NSNumber creation
            @try {
                NSDictionary *windowInfo = @{
                    @"id": [NSNumber numberWithInt:windowIdCounter],
                    @"cgWindowID": [NSNumber numberWithUnsignedInt:cgWindowID],
                    @"title": windowStr ?: @"",
                    @"app": ownerStr ?: @"",
                    @"position": @{
                        @"x": [NSNumber numberWithInt:(int)bounds.origin.x],
                        @"y": [NSNumber numberWithInt:(int)bounds.origin.y]
                    },
                    @"size": @{
                        @"width": [NSNumber numberWithInt:(int)bounds.size.width],
                        @"height": [NSNumber numberWithInt:(int)bounds.size.height]
                    }
                };
                
                [windows addObject:windowInfo];
                windowIdCounter++;
            } @catch (NSException *exception) {
                // Skip this window if there's an error creating the dictionary
                continue;
            }
        }
        
        CFRelease(windowList);
        
        // Convert to JSON safely
        @try {
            NSError *jsonError = nil;
            NSData *jsonData = [NSJSONSerialization dataWithJSONObject:windows options:0 error:&jsonError];
            
            if (jsonError || !jsonData) {
                printf("[]");
                return 0;
            }
            
            NSString *jsonString = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
            if (jsonString) {
                printf("%s", [jsonString UTF8String]);
            } else {
                printf("[]");
            }
        } @catch (NSException *exception) {
            printf("[]");
        }
    }
    return 0;
}