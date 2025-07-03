#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ApplicationServices/ApplicationServices.h>
#import "vp9_encoder.h"

typedef enum {
    CaptureTypeFullDesktop = 0,
    CaptureTypeApplication = 1,
    CaptureTypeWindow = 2
} CaptureType;

@interface ScreenCapture : NSObject <SCStreamOutput, SCStreamDelegate>
@property (nonatomic, strong) SCStream *stream;
@property (nonatomic, strong) dispatch_queue_t outputQueue;
@property (nonatomic, strong) dispatch_queue_t inputQueue;
@property (nonatomic, assign) CMTime firstSampleTime;
@property (nonatomic, assign) CaptureType captureType;
@property (nonatomic, assign) int targetIndex;
@property (nonatomic, strong) NSMutableData *currentFrame;
@property (nonatomic, assign) BOOL isCapturing;
@property (nonatomic, strong) NSString *cachedWindowsList;
@property (nonatomic, strong) NSTimer *windowsUpdateTimer;
@property (nonatomic, assign) BOOL useVP9Mode;
@property (nonatomic, strong) VP9Encoder *vp9Encoder;
@property (nonatomic, strong) NSMutableData *vp9FrameData;
@property (nonatomic, strong) NSMutableArray *hlsSegments;
@property (nonatomic, assign) int currentSegmentIndex;
@property (nonatomic, assign) NSTimeInterval lastFrameTime;
@property (nonatomic, assign) float currentServerFPS;
@property (nonatomic, assign) VTCompressionSessionRef compressionSession;
@property (nonatomic, strong) NSMutableData *h264Data;
@property (nonatomic, strong) NSMutableData *mpegtsData;
@property (nonatomic, assign) CGFloat coordinateScaleX;
@property (nonatomic, assign) CGFloat coordinateScaleY;
@property (nonatomic, assign) CGFloat coordinateOffsetX;
@property (nonatomic, assign) CGFloat coordinateOffsetY;
@property (nonatomic, assign) BOOL coordinatesCalibrated;
@end

@implementation ScreenCapture

- (instancetype)init {
    return [self initWithCaptureType:CaptureTypeFullDesktop targetIndex:0];
}

- (instancetype)initWithCaptureType:(CaptureType)captureType targetIndex:(int)targetIndex {
    self = [super init];
    if (self) {
        self.outputQueue = dispatch_queue_create("screencap.output", DISPATCH_QUEUE_SERIAL);
        self.inputQueue = dispatch_queue_create("screencap.input", DISPATCH_QUEUE_SERIAL);
        self.firstSampleTime = kCMTimeZero;
        self.captureType = captureType;
        self.targetIndex = targetIndex;
        self.currentFrame = [NSMutableData data];
        self.vp9FrameData = [NSMutableData data];
        self.hlsSegments = [NSMutableArray array];
        self.currentSegmentIndex = 0;
        self.lastFrameTime = 0;
        self.currentServerFPS = 0;
        self.coordinateScaleX = 1.0;
        self.coordinateScaleY = 1.0;
        self.coordinateOffsetX = 0.0;
        self.coordinateOffsetY = 0.0;
        self.coordinatesCalibrated = NO;
        self.isCapturing = NO;
        self.cachedWindowsList = @"[]"; // Default empty list
        [self startWindowsCaching];
        [self setupCapture];
    }
    return self;
}

- (void)startWindowsCaching {
    // Update windows list every 2 seconds on background thread
    self.windowsUpdateTimer = [NSTimer scheduledTimerWithTimeInterval:2.0 repeats:YES block:^(NSTimer * _Nonnull timer) {
        dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_LOW, 0), ^{
            [self updateWindowsCache];
        });
    }];
    
    // Get initial list immediately
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_LOW, 0), ^{
        [self updateWindowsCache];
    });
}

- (void)updateWindowsCache {
    NSString *newList = [self generateWindowsList];
    if (newList) {
        self.cachedWindowsList = newList;
    }
}

- (void)setupCapture {
    NSLog(@"🚀 Setting up ScreenCaptureKit...");
    
    // Check and request screen capture permissions
    if (!CGPreflightScreenCaptureAccess()) {
        NSLog(@"❌ No screen capture permission!");
        NSLog(@"🔒 Requesting screen capture access...");
        
        // This will trigger the permission dialog
        CGRequestScreenCaptureAccess();
        
        // Wait a bit and check again
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            if (!CGPreflightScreenCaptureAccess()) {
                NSLog(@"❌ Still no screen capture permission! Please enable in System Preferences > Privacy & Security > Screen Recording");
                exit(1);
            } else {
                NSLog(@"✅ Screen capture permission granted!");
                [self continueSetup];
            }
        });
        return;
    }
    
    [self continueSetup];
}

- (void)continueSetup {
    // Get available content
    [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
        if (error) {
            NSLog(@"❌ Error getting shareable content: %@", error.localizedDescription);
            return;
        }
        
        SCContentFilter *filter = nil;
        CGSize captureSize = CGSizeMake(1920, 1080); // Default size
        
        if (self.captureType == CaptureTypeFullDesktop) {
            // Full desktop capture (existing logic)
            if (content.displays.count == 0) {
                NSLog(@"❌ No displays found!");
                return;
            }
            
            SCDisplay *display = content.displays.firstObject;
            NSLog(@"✅ Found display: %u (%d x %d)", display.displayID, (int)display.width, (int)display.height);
            captureSize = CGSizeMake(display.width, display.height);
            filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
            
        } else if (self.captureType == CaptureTypeApplication) {
            // Application capture - get applications with visible names
            NSArray *allApplications = content.applications;
            NSMutableArray *visibleApplications = [NSMutableArray array];
            
            for (SCRunningApplication *app in allApplications) {
                if (app.applicationName && ![app.applicationName isEqualToString:@""]) {
                    [visibleApplications addObject:app];
                }
            }
            
            if (self.targetIndex <= 0 || self.targetIndex > visibleApplications.count) {
                NSLog(@"❌ Invalid application index: %d (available: 1-%lu)", self.targetIndex, (unsigned long)visibleApplications.count);
                return;
            }
            
            SCRunningApplication *targetApp = visibleApplications[self.targetIndex - 1];
            NSLog(@"✅ Capturing application: %@ (PID: %d)", targetApp.applicationName, targetApp.processID);
            
            // Get all visible windows for this application
            NSMutableArray *appWindows = [NSMutableArray array];
            for (SCWindow *window in content.windows) {
                if (window.owningApplication.processID == targetApp.processID && 
                    window.title && ![window.title isEqualToString:@""] &&
                    window.frame.size.width > 100 && window.frame.size.height > 100) {
                    [appWindows addObject:window];
                }
            }
            
            if (appWindows.count == 0) {
                NSLog(@"❌ No visible windows found for application: %@", targetApp.applicationName);
                return;
            }
            
            // Sort windows by size (largest first)
            [appWindows sortUsingComparator:^NSComparisonResult(SCWindow *a, SCWindow *b) {
                CGFloat areaA = a.frame.size.width * a.frame.size.height;
                CGFloat areaB = b.frame.size.width * b.frame.size.height;
                return areaB > areaA ? NSOrderedAscending : NSOrderedDescending;
            }];
            
            SCWindow *mainWindow = appWindows.firstObject;
            NSLog(@"📏 Main window: %@ (%.0fx%.0f)", mainWindow.title, mainWindow.frame.size.width, mainWindow.frame.size.height);
            
            captureSize = mainWindow.frame.size;
            
            // Use display-based filter with included applications to avoid CGS issues
            SCDisplay *display = content.displays.firstObject;
            NSMutableArray *excludedWindows = [NSMutableArray array];
            
            // Exclude windows from other applications
            for (SCWindow *window in content.windows) {
                if (window.owningApplication.processID != targetApp.processID) {
                    [excludedWindows addObject:window];
                }
            }
            
            filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:excludedWindows];
            
        } else if (self.captureType == CaptureTypeWindow) {
            // Individual window capture by CGWindowID
            UInt32 targetCGWindowID = (UInt32)self.targetIndex; // targetIndex stores the CGWindowID
            NSArray *windows = content.windows;
            
            SCWindow *targetWindow = nil;
            for (SCWindow *window in windows) {
                if (window.windowID == targetCGWindowID) {
                    targetWindow = window;
                    break;
                }
            }
            
            if (!targetWindow) {
                NSLog(@"❌ Window with CGWindowID %u not found in available windows", targetCGWindowID);
                NSLog(@"💡 Available windows count: %lu", (unsigned long)windows.count);
                // Fallback to full desktop if window not found
                NSLog(@"🔄 Falling back to full desktop capture");
                SCDisplay *display = content.displays.firstObject;
                if (display) {
                    captureSize = CGSizeMake(display.width, display.height);
                    filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
                }
            } else {
                NSLog(@"✅ Found and capturing window: %@ - %@ (%.0fx%.0f) [CGWindowID: %u]", 
                      targetWindow.owningApplication.applicationName ?: @"Unknown", 
                      targetWindow.title ?: @"Untitled", 
                      targetWindow.frame.size.width, 
                      targetWindow.frame.size.height,
                      targetCGWindowID);
                
                captureSize = targetWindow.frame.size;
                filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:targetWindow];
            }
        }
        
        if (!filter) {
            NSLog(@"❌ Failed to create content filter");
            return;
        }
        
        // Configure stream - 30 FPS for all capture types
        SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
        
        // Configure capture size
        config.width = (int)captureSize.width;
        config.height = (int)captureSize.height;
        
        // Log capture mode and size for debugging
        if (self.captureType == CaptureTypeWindow) {
            NSLog(@"🔧 Window capture: Size %zux%zu", config.width, config.height);
        } else {
            NSLog(@"🔧 Desktop capture: Size %zux%zu", config.width, config.height);
        }
        
        config.queueDepth = 6;
        config.pixelFormat = kCVPixelFormatType_32BGRA;
        config.colorSpaceName = kCGColorSpaceSRGB;
        config.showsCursor = YES;
        config.minimumFrameInterval = CMTimeMake(1, 30); // 30 FPS
        
        // Enable headless capture for locked screens and closed lids
        if (@available(macOS 13.0, *)) {
            config.capturesAudio = NO;
            config.sampleRate = 0;
            config.channelCount = 0;
            // These experimental settings may help with headless capture
            NSLog(@"🔧 Attempting headless capture configuration...");
        }
        
        NSLog(@"🔧 Configured stream for headless capture (locked screen / lid closed support)");
        
        // VP9/High Quality mode - use better JPEG settings
        if (self.useVP9Mode) {
            NSLog(@"🚀 High Quality mode enabled: %zux%zu", config.width, config.height);
        }
        
        // Create stream with error delegate
        self.stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:self];
        
        NSError *streamError;
        BOOL success = [self.stream addStreamOutput:self type:SCStreamOutputTypeScreen sampleHandlerQueue:self.outputQueue error:&streamError];
        
        if (!success || streamError) {
            NSLog(@"❌ Error adding stream output: %@", streamError.localizedDescription);
            return;
        }
        
        // Start capture
        [self.stream startCaptureWithCompletionHandler:^(NSError * _Nullable startError) {
            if (startError) {
                NSLog(@"❌ Error starting capture: %@", startError.localizedDescription);
            } else {
                NSString *captureTypeStr = self.captureType == CaptureTypeFullDesktop ? @"full desktop" : 
                                          self.captureType == CaptureTypeApplication ? @"application" : @"window";
                NSLog(@"✅ %@ capture started successfully at 30 FPS!", captureTypeStr);
                NSLog(@"📝 Send commands via stdin: 'click x y' or 'key character'");
            }
        }];
    }];
}

- (void)startInputListener {
    NSLog(@"👂 Starting input listener on stdin...");
    dispatch_async(self.inputQueue, ^{
        char buffer[256];
        while (fgets(buffer, sizeof(buffer), stdin)) {
            NSString *command = [NSString stringWithCString:buffer encoding:NSUTF8StringEncoding];
            command = [command stringByTrimmingCharactersInSet:[NSCharacterSet newlineCharacterSet]];
            NSLog(@"📥 Received command: '%@'", command);
            [self processCommand:command];
        }
    });
}

- (void)processCommand:(NSString *)command {
    NSArray *parts = [command componentsSeparatedByString:@" "];
    if (parts.count == 0) {
        NSLog(@"❓ Empty command received");
        return;
    }
    
    NSString *action = parts[0];
    NSLog(@"🔍 Processing action: '%@' with %lu parts", action, (unsigned long)parts.count);
    
    if ([action isEqualToString:@"click"] && parts.count >= 3) {
        int x = [parts[1] intValue];
        int y = [parts[2] intValue];
        NSLog(@"🎯 Parsed click coordinates: x=%d, y=%d", x, y);
        [self performClick:x y:y];
    } else if ([action isEqualToString:@"key"] && parts.count >= 2) {
        NSString *key = parts[1];
        NSLog(@"🎯 Parsed key: '%@'", key);
        [self performKeyPress:key];
    } else {
        NSLog(@"❓ Unknown command: '%@' (parts: %@)", command, parts);
    }
}

- (void)performClick:(int)x y:(int)y {
    [self performClick:x y:y targetWindowID:0];
}

- (void)performClick:(int)x y:(int)y targetWindowID:(UInt32)windowID {
    [self performClick:x y:y targetWindowID:windowID activateWindow:YES];
}

- (void)performClick:(int)x y:(int)y targetWindowID:(UInt32)windowID activateWindow:(BOOL)activate {
    NSLog(@"🖱️ Final click at %d,%d (target window: %u, activate: %@)", x, y, windowID, activate ? @"YES" : @"NO");
    
    // Coordinates are already transformed in handleClickRequest - use directly
    int finalX = x;
    int finalY = y;
    
    @try {
        // Check accessibility permissions
        if (!AXIsProcessTrusted()) {
            NSLog(@"❌ No accessibility permission for mouse events!");
            NSLog(@"🔒 Please enable accessibility for this app in System Preferences > Privacy & Security > Accessibility");
            return;
        }
        
        NSLog(@"✅ Accessibility permission verified");
        
        CGPoint clickPoint = CGPointMake(finalX, finalY);
        
        // If we have a target window, bring it to front (coordinates are already scaled properly)
        if (windowID != 0) {
            NSLog(@"🎯 Targeting specific window ID: %u at coordinates %d,%d", windowID, finalX, finalY);
            
            // Always activate the window to bring it to front
            [self activateWindowIfNeeded:windowID];
            
            // Don't adjust coordinates - they're already scaled correctly from the server
            NSLog(@"🎯 Using provided coordinates directly (already scaled): %.0f,%.0f", clickPoint.x, clickPoint.y);
        }
        
        // Use window-specific events if we have a target window
        if (windowID != 0) {
            NSLog(@"🎯 Sending window-specific click events to window %u", windowID);
            
            // Try to find the specific window element and click it directly
            pid_t targetPID = [self getProcessIDForWindowID:windowID];
            if (targetPID > 0) {
                AXUIElementRef appElement = AXUIElementCreateApplication(targetPID);
                if (appElement) {
                    CFArrayRef windows;
                    AXError result = AXUIElementCopyAttributeValues(appElement, kAXWindowsAttribute, 0, 100, &windows);
                    
                    if (result == kAXErrorSuccess && windows) {
                        CFIndex windowCount = CFArrayGetCount(windows);
                        
                        for (CFIndex j = 0; j < windowCount; j++) {
                            AXUIElementRef windowElement = (AXUIElementRef)CFArrayGetValueAtIndex(windows, j);
                            
                            // Get window position to match with our CGWindowID
                            CFTypeRef positionValue;
                            if (AXUIElementCopyAttributeValue(windowElement, kAXPositionAttribute, &positionValue) == kAXErrorSuccess) {
                                CGPoint windowPos;
                                if (AXValueGetValue(positionValue, kAXValueCGPointType, &windowPos)) {
                                    // Check if this matches our target window position
                                    CFArrayRef cgWindows = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
                                    if (cgWindows) {
                                        CFIndex cgCount = CFArrayGetCount(cgWindows);
                                        for (CFIndex k = 0; k < cgCount; k++) {
                                            CFDictionaryRef cgWindow = (CFDictionaryRef)CFArrayGetValueAtIndex(cgWindows, k);
                                            CFNumberRef cgWindowNumber = (CFNumberRef)CFDictionaryGetValue(cgWindow, kCGWindowNumber);
                                            UInt32 cgID;
                                            CFNumberGetValue(cgWindowNumber, kCFNumberSInt32Type, &cgID);
                                            
                                            if (cgID == windowID) {
                                                CFDictionaryRef bounds = (CFDictionaryRef)CFDictionaryGetValue(cgWindow, kCGWindowBounds);
                                                if (bounds) {
                                                    CGRect cgRect;
                                                    CGRectMakeWithDictionaryRepresentation(bounds, &cgRect);
                                                    
                                                    // If positions match (within 5 pixels), this is our window
                                                    if (fabs(windowPos.x - cgRect.origin.x) < 5 && fabs(windowPos.y - cgRect.origin.y) < 5) {
                                                        // Found the correct window - bring it to front
                                                        AXUIElementSetAttributeValue(windowElement, kAXMainAttribute, kCFBooleanTrue);
                                                        AXUIElementSetAttributeValue(windowElement, kAXFocusedAttribute, kCFBooleanTrue);
                                                        usleep(100000); // 100ms delay for window to focus
                                                        
                                                        NSLog(@"✅ Brought specific window to front, using original coordinates");
                                                        
                                                        CFRelease(cgWindows);
                                                        
                                                        // Use the original click coordinates since the window is now focused
                                                        CGPoint originalPoint = CGPointMake(x, y);
                                                        CGEventRef mouseDown = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, originalPoint, kCGMouseButtonLeft);
                                                        CGEventRef mouseUp = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, originalPoint, kCGMouseButtonLeft);
                                                        
                                                        if (mouseDown && mouseUp) {
                                                            NSLog(@"📤 Posting targeted click at original coordinates %d,%d", x, y);
                                                            CGEventPost(kCGHIDEventTap, mouseDown);
                                                            usleep(10000); // 10ms between down and up
                                                            CGEventPost(kCGHIDEventTap, mouseUp);
                                                            
                                                            CFRelease(mouseDown);
                                                            CFRelease(mouseUp);
                                                            NSLog(@"✅ Window-specific click completed successfully");
                                                        }
                                                        
                                                        goto cleanup_and_return;
                                                    }
                                                }
                                            }
                                        }
                                        CFRelease(cgWindows);
                                    }
                                }
                                CFRelease(positionValue);
                            }
                        }
                        CFRelease(windows);
                    }
                    CFRelease(appElement);
                }
            }
            
            NSLog(@"⚠️ Window-specific click failed, falling back to global events");
        }
        
        // Fallback to global events
        CGEventRef mouseDown = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, clickPoint, kCGMouseButtonLeft);
        CGEventRef mouseUp = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, clickPoint, kCGMouseButtonLeft);
        
        NSLog(@"📝 Created mouse events: down=%p, up=%p", mouseDown, mouseUp);
        
        if (mouseDown && mouseUp) {
            NSLog(@"📤 Posting global mouse events...");
            CGEventPost(kCGHIDEventTap, mouseDown);
            CGEventPost(kCGHIDEventTap, mouseUp);
            
            CFRelease(mouseDown);
            CFRelease(mouseUp);
            NSLog(@"✅ Click executed and events released");
        } else {
            NSLog(@"❌ Failed to create mouse events");
            if (mouseDown) CFRelease(mouseDown);
            if (mouseUp) CFRelease(mouseUp);
        }
        
        cleanup_and_return:;
    } @catch (NSException *exception) {
        NSLog(@"❌ Exception in performClick: %@", exception);
    }
}

- (pid_t)getProcessIDForWindowID:(UInt32)windowID {
    CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    pid_t targetPID = 0;
    
    if (windowList) {
        CFIndex count = CFArrayGetCount(windowList);
        for (CFIndex i = 0; i < count; i++) {
            CFDictionaryRef window = (CFDictionaryRef)CFArrayGetValueAtIndex(windowList, i);
            CFNumberRef windowNumber = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowNumber);
            
            UInt32 currentWindowID;
            CFNumberGetValue(windowNumber, kCFNumberSInt32Type, &currentWindowID);
            
            if (currentWindowID == windowID) {
                CFNumberRef ownerPID = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowOwnerPID);
                if (ownerPID) {
                    CFNumberGetValue(ownerPID, kCFNumberSInt32Type, &targetPID);
                }
                break;
            }
        }
        CFRelease(windowList);
    }
    
    return targetPID;
}

- (void)activateWindowIfNeeded:(UInt32)windowID {
    NSLog(@"🎯 Attempting to activate specific window %u for better event delivery", windowID);
    
    // First try to bring the specific window to front using Core Graphics
    CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    if (windowList) {
        CFIndex count = CFArrayGetCount(windowList);
        for (CFIndex i = 0; i < count; i++) {
            CFDictionaryRef window = (CFDictionaryRef)CFArrayGetValueAtIndex(windowList, i);
            CFNumberRef windowNumber = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowNumber);
            
            UInt32 currentWindowID;
            CFNumberGetValue(windowNumber, kCFNumberSInt32Type, &currentWindowID);
            
            if (currentWindowID == windowID) {
                // Found our target window - get its info
                CFStringRef windowTitle = (CFStringRef)CFDictionaryGetValue(window, kCGWindowName);
                CFStringRef ownerName = (CFStringRef)CFDictionaryGetValue(window, kCGWindowOwnerName);
                
                NSString *title = windowTitle ? (__bridge NSString *)windowTitle : @"Untitled";
                NSString *owner = ownerName ? (__bridge NSString *)ownerName : @"Unknown";
                NSLog(@"🎯 Found target window: '%@' from '%@'", title, owner);
                
                // Get the process ID and activate the application first
                pid_t targetPID = [self getProcessIDForWindowID:windowID];
                if (targetPID > 0) {
                    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:targetPID];
                    if (app) {
                        NSLog(@"🎯 Activating application: %@", app.localizedName);
                        [app activateWithOptions:0];
                        usleep(200000); // 200ms - longer wait for app activation
                    }
                }
                
                // Now try to bring this specific window to front using accessibility
                AXUIElementRef appElement = AXUIElementCreateApplication(targetPID);
                if (appElement) {
                    CFArrayRef windows;
                    AXError result = AXUIElementCopyAttributeValues(appElement, kAXWindowsAttribute, 0, 100, &windows);
                    
                    if (result == kAXErrorSuccess && windows) {
                        CFIndex windowCount = CFArrayGetCount(windows);
                        NSLog(@"🔍 Found %ld windows in app, looking for window %u", windowCount, windowID);
                        
                        for (CFIndex j = 0; j < windowCount; j++) {
                            AXUIElementRef windowElement = (AXUIElementRef)CFArrayGetValueAtIndex(windows, j);
                            
                            // Try to bring this window to front
                            AXError frontResult = AXUIElementSetAttributeValue(windowElement, kAXMainAttribute, kCFBooleanTrue);
                            AXError focusResult = AXUIElementSetAttributeValue(windowElement, kAXFocusedAttribute, kCFBooleanTrue);
                            
                            if (frontResult == kAXErrorSuccess) {
                                NSLog(@"✅ Successfully brought window to front using AX");
                                usleep(100000); // 100ms
                                break;
                            }
                        }
                        CFRelease(windows);
                    }
                    CFRelease(appElement);
                }
                break;
            }
        }
        CFRelease(windowList);
    }
    
    NSLog(@"✅ Window activation sequence completed");
}

- (void)performKeyPress:(NSString *)key {
    [self performKeyPress:key withModifiers:NO ctrl:NO alt:NO shift:NO];
}

- (void)performKeyPress:(NSString *)key targetWindowID:(UInt32)windowID {
    [self performKeyPress:key withModifiers:NO ctrl:NO alt:NO shift:NO targetWindowID:windowID];
}

// New methods with modifier support
- (void)performKeyPress:(NSString *)key withModifiers:(BOOL)cmd ctrl:(BOOL)ctrl alt:(BOOL)alt shift:(BOOL)shift {
    [self performKeyPress:key withModifiers:cmd ctrl:ctrl alt:alt shift:shift targetWindowID:0];
}

- (void)performKeyPress:(NSString *)key withModifiers:(BOOL)cmd ctrl:(BOOL)ctrl alt:(BOOL)alt shift:(BOOL)shift targetWindowID:(UInt32)windowID {
    NSLog(@"⌨️ Key press with modifiers: %@ (target window: %u, cmd:%@, ctrl:%@, alt:%@, shift:%@)", 
          key, windowID, cmd ? @"YES" : @"NO", ctrl ? @"YES" : @"NO", alt ? @"YES" : @"NO", shift ? @"YES" : @"NO");
    
    if (!key || key.length == 0) {
        NSLog(@"❌ Empty key string");
        return;
    }
    
    // Check accessibility permissions
    if (!AXIsProcessTrusted()) {
        NSLog(@"❌ No accessibility permission for keyboard events!");
        NSLog(@"🔒 Please enable accessibility for this app in System Preferences > Privacy & Security > Accessibility");
        return;
    }
    
    // If targeting a specific window, bring it to front first
    if (windowID != 0) {
        NSLog(@"🎯 Targeting specific window ID: %u", windowID);
        [self activateWindowIfNeeded:windowID];
    }
    
    CGKeyCode keyCode = 0;
    NSLog(@"🔤 Processing key: '%@'", key);

    // Handle special keys first (from event.key strings)
    if ([key isEqualToString:@"Enter"] || [key isEqualToString:@"Return"]) {
        keyCode = 36; // Return/Enter
    } else if ([key isEqualToString:@"Backspace"]) {
        keyCode = 51; // Delete/Backspace
    } else if ([key isEqualToString:@"Delete"]) {
        keyCode = 117; // Forward Delete
    } else if ([key isEqualToString:@"Tab"]) {
        keyCode = 48; // Tab
    } else if ([key isEqualToString:@"Escape"]) {
        keyCode = 53; // Escape
    } else if ([key isEqualToString:@"ArrowUp"]) {
        keyCode = 126; // Up Arrow
    } else if ([key isEqualToString:@"ArrowDown"]) {
        keyCode = 125; // Down Arrow
    } else if ([key isEqualToString:@"ArrowLeft"]) {
        keyCode = 123; // Left Arrow
    } else if ([key isEqualToString:@"ArrowRight"]) {
        keyCode = 124; // Right Arrow
    } else if ([key isEqualToString:@"Home"]) {
        keyCode = 115; // Home
    } else if ([key isEqualToString:@"End"]) {
        keyCode = 119; // End
    } else if ([key isEqualToString:@"PageUp"]) {
        keyCode = 116; // Page Up
    } else if ([key isEqualToString:@"PageDown"]) {
        keyCode = 121; // Page Down
    } else if (key.length == 1) {
        // Handle single character keys
        unichar character = [key characterAtIndex:0];
        NSLog(@"🔤 Processing character: '%c' (unicode: %d)", character, character);

        switch (character) {
            case 'a': case 'A': keyCode = 0; break;
            case 's': case 'S': keyCode = 1; break;
            case 'd': case 'D': keyCode = 2; break;
            case 'f': case 'F': keyCode = 3; break;
            case 'h': case 'H': keyCode = 4; break;
            case 'g': case 'G': keyCode = 5; break;
            case 'z': case 'Z': keyCode = 6; break;
            case 'x': case 'X': keyCode = 7; break;
            case 'c': case 'C': keyCode = 8; break;
            case 'v': case 'V': keyCode = 9; break;
            case 'b': case 'B': keyCode = 11; break;
            case 'q': case 'Q': keyCode = 12; break;
            case 'w': case 'W': keyCode = 13; break;
            case 'e': case 'E': keyCode = 14; break;
            case 'r': case 'R': keyCode = 15; break;
            case 'y': case 'Y': keyCode = 16; break;
            case 't': case 'T': keyCode = 17; break;
            case '1': keyCode = 18; break;
            case '2': keyCode = 19; break;
            case '3': keyCode = 20; break;
            case '4': keyCode = 21; break;
            case '6': keyCode = 22; break;
            case '5': keyCode = 23; break;
            case '=': keyCode = 24; break;
            case '9': keyCode = 25; break;
            case '7': keyCode = 26; break;
            case '-': keyCode = 27; break;
            case '8': keyCode = 28; break;
            case '0': keyCode = 29; break;
            case ']': keyCode = 30; break;
            case 'o': case 'O': keyCode = 31; break;
            case 'u': case 'U': keyCode = 32; break;
            case '[': keyCode = 33; break;
            case 'i': case 'I': keyCode = 34; break;
            case 'p': case 'P': keyCode = 35; break;
            case 'l': case 'L': keyCode = 37; break;
            case 'j': case 'J': keyCode = 38; break;
            case '\'': keyCode = 39; break;
            case 'k': case 'K': keyCode = 40; break;
            case ';': keyCode = 41; break;
            case '\\': keyCode = 42; break;
            case ',': keyCode = 43; break;
            case '/': keyCode = 44; break;
            case 'n': case 'N': keyCode = 45; break;
            case 'm': case 'M': keyCode = 46; break;
            case '.': keyCode = 47; break;
            case ' ': keyCode = 49; break; // Space
            case '`': keyCode = 50; break; // Backtick
            default:
                NSLog(@"❓ Unknown character: '%c' (unicode: %d)", character, character);
                return;
        }
    } else {
        NSLog(@"❓ Unknown key: %@", key);
        return;
    }
    
    NSLog(@"📤 Creating keyboard events with modifiers for keyCode: %d", keyCode);
    
    // Create key events with modifier flags
    CGEventFlags flags = 0;
    if (cmd) flags |= kCGEventFlagMaskCommand;
    if (ctrl) flags |= kCGEventFlagMaskControl;
    if (alt) flags |= kCGEventFlagMaskAlternate;
    if (shift) flags |= kCGEventFlagMaskShift;
    
    CGEventRef keyDown = CGEventCreateKeyboardEvent(NULL, keyCode, true);
    CGEventRef keyUp = CGEventCreateKeyboardEvent(NULL, keyCode, false);
    
    if (keyDown && keyUp) {
        // Always set modifier flags (even if 0 to clear existing flags)
        CGEventSetFlags(keyDown, flags);
        CGEventSetFlags(keyUp, flags);
        NSLog(@"📤 Set modifier flags: 0x%llx", (unsigned long long)flags);
        
        NSLog(@"📤 Posting keyboard events with modifiers...");
        CGEventPost(kCGHIDEventTap, keyDown);
        CGEventPost(kCGHIDEventTap, keyUp);
        
        CFRelease(keyDown);
        CFRelease(keyUp);
        NSLog(@"✅ Key press with modifiers completed");
    } else {
        NSLog(@"❌ Failed to create keyboard events");
        if (keyDown) CFRelease(keyDown);
        if (keyUp) CFRelease(keyUp);
    }
}

#pragma mark - SCStreamOutput

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeScreen) return;
    
    // Only process frames from the current active stream
    if (stream != self.stream) {
        static int ignoreCount = 0;
        if (++ignoreCount % 300 == 0) {
            NSLog(@"🚫 Ignoring frame from old stream %p (current: %p)", stream, self.stream);
        }
        return;
    }
    
    // Reset frame failure counter when we get a successful frame
    static int frameFailureCount = 0;
    frameFailureCount = 0;
    
    // Debug: Log actual frame delivery rate
    static int debugFrameCount = 0;
    static NSTimeInterval debugLastLog = 0;
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
    debugFrameCount++;
    
    if (now - debugLastLog >= 1.0) {
        NSLog(@"🎥 ScreenCaptureKit delivering %d FPS to didOutputSampleBuffer", debugFrameCount);
        debugFrameCount = 0;
        debugLastLog = now;
    }
    
    // Log which stream this is coming from
    static int streamLogCount = 0;
    if (++streamLogCount % 900 == 0) { // Every 30 seconds
        NSLog(@"🎬 Frame from current stream %p | Mode: %d | Target: %d", 
              stream, (int)self.captureType, self.targetIndex);
    }
    
    // Check frame status like the example does
    CFArrayRef attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, FALSE);
    if (!attachmentsArray) return;
    
    CFDictionaryRef attachments = CFArrayGetValueAtIndex(attachmentsArray, 0);
    if (!attachments) return;
    
    // Check if frame is complete
    CFNumberRef statusNum = CFDictionaryGetValue(attachments, CFSTR("SCStreamFrameInfo.status"));
    if (statusNum) {
        int status;
        CFNumberGetValue(statusNum, kCFNumberIntType, &status);
        if (status != 0) return; // 0 = SCFrameStatusComplete
    }
    
    // Get image buffer
    CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!imageBuffer) return;
    
    // Lock the buffer
    CVPixelBufferLockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
    
    // Create CGImage from buffer - simplified approach
    size_t width = CVPixelBufferGetWidth(imageBuffer);
    size_t height = CVPixelBufferGetHeight(imageBuffer);
    size_t bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer);
    void *baseAddress = CVPixelBufferGetBaseAddress(imageBuffer);
    
    CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef bitmapContext = CGBitmapContextCreate(baseAddress, width, height, 8, bytesPerRow, 
                                                       colorSpace, kCGImageAlphaNoneSkipFirst | kCGBitmapByteOrder32Little);
    
    if (bitmapContext) {
        CGImageRef cgImage = CGBitmapContextCreateImage(bitmapContext);
        
        // Add a colored border for window captures to verify it's working
        if (self.captureType == CaptureTypeWindow && cgImage) {
            CGContextRef borderContext = CGBitmapContextCreate(NULL, width, height, 8, 0,
                                                              colorSpace, kCGImageAlphaPremultipliedFirst);
            if (borderContext) {
                // Draw the original image
                CGContextDrawImage(borderContext, CGRectMake(0, 0, width, height), cgImage);
                
                // Draw a green border for window captures
                CGContextSetRGBStrokeColor(borderContext, 0.0, 1.0, 0.0, 1.0); // Green
                CGContextSetLineWidth(borderContext, 10.0);
                CGContextStrokeRect(borderContext, CGRectMake(5, 5, width-10, height-10));
                
                // Draw window ID text
                NSString *windowText = [NSString stringWithFormat:@"Window: %d", self.targetIndex];
                NSAttributedString *attrStr = [[NSAttributedString alloc] initWithString:windowText
                    attributes:@{NSFontAttributeName: [NSFont boldSystemFontOfSize:24],
                               NSForegroundColorAttributeName: [NSColor greenColor]}];
                
                CGContextSetRGBFillColor(borderContext, 0.0, 0.0, 0.0, 0.7); // Black background
                CGContextFillRect(borderContext, CGRectMake(10, 10, 200, 40));
                
                // Replace the original image with the bordered one
                CGImageRelease(cgImage);
                cgImage = CGBitmapContextCreateImage(borderContext);
                CGContextRelease(borderContext);
            }
        }
        
        if (cgImage) {
            // Try VP9 encoding first if enabled
            if (self.useVP9Mode) {
                [self tryVP9Encoding:imageBuffer width:width height:height];
            }
            
            // Always generate JPEG as fallback
            NSMutableData *jpegData = [NSMutableData data];
            CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)jpegData,
                                                                                 (__bridge CFStringRef)UTTypeJPEG.identifier,
                                                                                 1, NULL);
            
            if (destination) {
                // Set JPEG quality - Optimized for performance
                float quality = 0.75; // Good balance of quality and speed
                int maxSize = 1920; // Standard resolution for good performance
                
                NSDictionary *options = @{
                    (__bridge NSString*)kCGImageDestinationLossyCompressionQuality: @(quality),
                    (__bridge NSString*)kCGImageDestinationImageMaxPixelSize: @(maxSize)
                };
                
                CGImageDestinationAddImage(destination, cgImage, (__bridge CFDictionaryRef)options);
                CGImageDestinationFinalize(destination);
                CFRelease(destination);
                
                // Store JPEG data for HTTP server with timestamp
                @synchronized(self.currentFrame) {
                    [self.currentFrame setData:jpegData];
                    self.lastFrameTime = [[NSDate date] timeIntervalSince1970];
                }
                
                // VP9 mode: Encode both VP9 (for efficiency) and JPEG (for browser display)
                
                // Calculate server-side FPS with faster response
                NSTimeInterval currentTime = [[NSDate date] timeIntervalSince1970];
                static NSTimeInterval fpsWindowStart = 0;
                static int fpsFrameCount = 0;
                
                if (fpsWindowStart == 0) {
                    fpsWindowStart = currentTime;
                }
                
                fpsFrameCount++;
                NSTimeInterval windowDuration = currentTime - fpsWindowStart;
                
                // Update FPS every second using frame count method for accuracy
                if (windowDuration >= 1.0) {
                    self.currentServerFPS = fpsFrameCount / windowDuration;
                    fpsWindowStart = currentTime;
                    fpsFrameCount = 0;
                }
                
                self.lastFrameTime = currentTime;
                
                // Log progress occasionally (disabled to reduce spam)
                static int frameCount = 0;
                frameCount++;
                if (frameCount % 30 == 0) { // Every 1 second at 30fps
                    NSString *captureInfo = @"Unknown";
                    if (self.captureType == CaptureTypeFullDesktop) {
                        captureInfo = @"Full Desktop";
                    } else if (self.captureType == CaptureTypeWindow) {
                        captureInfo = [NSString stringWithFormat:@"Window ID: %d", self.targetIndex];
                    }
                    NSLog(@"📸 Captured %d frames | Mode: %@ | Size: %zux%zu | Server FPS: %.1f", 
                          frameCount, captureInfo, width, height, self.currentServerFPS);
                }
                
                // Update segment index for HLS (every 2 seconds at 30fps)
                if (frameCount % 60 == 0) {
                    self.currentSegmentIndex++;
                }
            }
            
            CGImageRelease(cgImage);
        }
        
        CGContextRelease(bitmapContext);
    }
    
    CGColorSpaceRelease(colorSpace);
    
    // Unlock the buffer
    CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
}

- (NSData *)getCurrentFrame {
    // Always return JPEG for web browser compatibility
    // VP9 encoding is used for logging/future WebRTC implementation
    @synchronized(self.currentFrame) {
        return [self.currentFrame copy];
    }
}

- (NSData *)getCurrentVP9Frame {
    // Return VP9 encoded frame (for future WebRTC/streaming use)
    @synchronized(self.vp9FrameData) {
        return [self.vp9FrameData copy];
    }
}

- (float)getCurrentServerFPS {
    return self.currentServerFPS;
}

- (void)calibrateCoordinates {
    NSLog(@"CLICK-CALIBRATE: 🎯 Starting automatic coordinate calibration...");
    
    // Get the main display info for calibration
    CGDirectDisplayID mainDisplay = CGMainDisplayID();
    CGRect displayBounds = CGDisplayBounds(mainDisplay);
    
    // Get capture dimensions from current frame
    if (self.currentFrame.length == 0) {
        NSLog(@"⚠️ No frame available for calibration, using default scaling");
        return;
    }
    
    // For retina displays, we need to account for the scale factor
    CGFloat scaleFactor = 1.0;
    if (@available(macOS 10.7, *)) {
        NSScreen *mainScreen = [NSScreen mainScreen];
        if (mainScreen) {
            scaleFactor = mainScreen.backingScaleFactor;
        }
    }
    
    // Calculate coordinate scaling based on capture mode
    if (self.captureType == CaptureTypeFullDesktop) {
        // Full desktop: browser shows logical size, we click at physical coordinates
        self.coordinateScaleX = scaleFactor;
        self.coordinateScaleY = scaleFactor;
        self.coordinateOffsetX = 0;
        self.coordinateOffsetY = 0;
        NSLog(@"🖥️ Full desktop calibration: scale=%.1f", scaleFactor);
    } else if (self.captureType == CaptureTypeWindow) {
        // Window capture: need to map browser coordinates to window coordinates
        // This requires getting the actual window bounds
        [self calibrateForWindowCapture];
    } else {
        // Default fallback
        self.coordinateScaleX = scaleFactor;
        self.coordinateScaleY = scaleFactor;
        self.coordinateOffsetX = 0;
        self.coordinateOffsetY = 0;
    }
    
    self.coordinatesCalibrated = YES;
    NSLog(@"CLICK-CALIBRATE: ✅ Coordinate calibration complete: Mode=%d, scaleX=%.3f, scaleY=%.3f, offsetX=%.1f, offsetY=%.1f", 
          self.captureType, self.coordinateScaleX, self.coordinateScaleY, self.coordinateOffsetX, self.coordinateOffsetY);
}

- (void)calibrateForWindowCapture {
    // For window capture, get the window bounds to calculate proper mapping
    CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
    
    if (windowList) {
        CFIndex count = CFArrayGetCount(windowList);
        for (CFIndex i = 0; i < count; i++) {
            CFDictionaryRef window = (CFDictionaryRef)CFArrayGetValueAtIndex(windowList, i);
            
            CFNumberRef windowID = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowNumber);
            if (windowID) {
                int32_t id;
                CFNumberGetValue(windowID, kCFNumberSInt32Type, &id);
                
                if (id == self.targetIndex) {
                    // Found our target window, get its bounds
                    CFDictionaryRef bounds = (CFDictionaryRef)CFDictionaryGetValue(window, kCGWindowBounds);
                    if (bounds) {
                        CGRect windowRect;
                        CGRectMakeWithDictionaryRepresentation(bounds, &windowRect);
                        
                        // For window capture: browser coordinates are relative to window
                        // but we need to click in screen coordinates
                        self.coordinateScaleX = 1.0; // No scaling needed for window coordinates
                        self.coordinateScaleY = 1.0;
                        self.coordinateOffsetX = windowRect.origin.x;
                        self.coordinateOffsetY = windowRect.origin.y;
                        
                        NSLog(@"🪟 Window calibration: bounds=(%.1f,%.1f,%.1f,%.1f)", 
                              windowRect.origin.x, windowRect.origin.y, windowRect.size.width, windowRect.size.height);
                        break;
                    }
                }
            }
        }
        CFRelease(windowList);
    }
}

- (void)performCoordinateVerification {
    // Get current mouse position as reference
    CGEventRef event = CGEventCreate(NULL);
    CGPoint mouseLocation = CGEventGetLocation(event);
    CFRelease(event);
    
    NSLog(@"🖱️ Current mouse position: (%.1f, %.1f)", mouseLocation.x, mouseLocation.y);
}

- (CGPoint)transformCoordinates:(CGPoint)webCoordinates {
    if (!self.coordinatesCalibrated) {
        [self calibrateCoordinates];
    }
    
    // Apply scaling and offset transformation
    CGPoint transformed = CGPointMake(
        (webCoordinates.x * self.coordinateScaleX) + self.coordinateOffsetX,
        (webCoordinates.y * self.coordinateScaleY) + self.coordinateOffsetY
    );
    
    NSLog(@"CLICK-CALIBRATE: 🔄 Coordinate transform: (%.1f, %.1f) → (%.1f, %.1f)", 
          webCoordinates.x, webCoordinates.y, transformed.x, transformed.y);
    
    return transformed;
}

- (void)adaptiveCoordinateCorrection:(CGPoint)clickedPoint expectedPoint:(CGPoint)expectedPoint {
    // Adaptive correction based on click feedback
    CGFloat errorX = expectedPoint.x - clickedPoint.x;
    CGFloat errorY = expectedPoint.y - clickedPoint.y;
    
    // Only adjust if error is significant (> 10 pixels)
    if (fabs(errorX) > 10 || fabs(errorY) > 10) {
        self.coordinateOffsetX += errorX * 0.5; // Gradual correction
        self.coordinateOffsetY += errorY * 0.5;
        
        NSLog(@"🔧 Adaptive correction: offset now (%.1f, %.1f)", 
              self.coordinateOffsetX, self.coordinateOffsetY);
    }
}

- (void)setupVP9Encoder {
    [self cleanupVP9Encoder];
    // VP9 encoder will be initialized with actual dimensions in frame processing
}

- (void)cleanupVP9Encoder {
    if (self.vp9Encoder) {
        [self.vp9Encoder cleanup];
        self.vp9Encoder = nil;
    }
}

- (void)tryVP9Encoding:(CVPixelBufferRef)pixelBuffer width:(size_t)width height:(size_t)height {
    // Initialize VP9 encoder with actual frame dimensions if needed
    if (!self.vp9Encoder || !self.vp9Encoder.isInitialized) {
        NSLog(@"🔧 Initializing VP9 encoder with dimensions %zux%zu", width, height);
        self.vp9Encoder = [[VP9Encoder alloc] initWithWidth:(int)width height:(int)height];
        
        if (!self.vp9Encoder.isInitialized) {
            NSLog(@"❌ Failed to initialize VP9 encoder, falling back to JPEG");
            return;
        }
    }
    
    // Encode the frame
    NSData *vp9Data = [self.vp9Encoder encodeFrame:pixelBuffer];
    
    if (vp9Data && vp9Data.length > 0) {
        // Store VP9 encoded data
        @synchronized(self.vp9FrameData) {
            [self.vp9FrameData setData:vp9Data];
        }
        
        // Log occasionally
        static int vp9FrameCount = 0;
        vp9FrameCount++;
        if (vp9FrameCount % 300 == 0) {
            NSLog(@"🎬 VP9 encoded %d frames | Size: %zu bytes | Compression: %.1fx", 
                  vp9FrameCount, vp9Data.length, (float)(width * height * 4) / vp9Data.length);
        }
    } else {
        NSLog(@"⚠️ VP9 encoding failed, using JPEG fallback");
    }
}

// getCurrentEncodedFrame method removed - using High Quality JPEG instead

- (void)startCaptureWithType:(CaptureType)captureType targetIndex:(int)targetIndex {
    [self startCaptureWithType:captureType targetIndex:targetIndex vp9Mode:NO];
}

- (void)startCaptureWithType:(CaptureType)captureType targetIndex:(int)targetIndex vp9Mode:(BOOL)useVP9 {
    self.captureType = captureType;
    self.targetIndex = targetIndex;
    self.useVP9Mode = useVP9;
    
    if (useVP9) {
        NSLog(@"🚀 Starting capture with VP9 encoding enabled");
        // Initialize VP9 encoder - we'll set dimensions once we know the capture size
        [self setupVP9Encoder];
    } else {
        NSLog(@"📸 Starting capture with standard MJPEG mode");
        [self cleanupVP9Encoder];
    }
    
    // Reset coordinate calibration for new capture session
    self.coordinatesCalibrated = NO;
    
    [self setupCapture];
}

- (void)startCaptureWithWindowID:(UInt32)windowID {
    [self startCaptureWithWindowID:windowID vp9Mode:NO];
}

- (void)startCaptureWithWindowID:(UInt32)windowID vp9Mode:(BOOL)useVP9 {
    NSLog(@"🎯 startCaptureWithWindowID called with ID: %u, VP9: %@", windowID, useVP9 ? @"YES" : @"NO");
    
    // Special method for capturing specific windows by CGWindowID
    self.captureType = CaptureTypeWindow;
    self.targetIndex = (int)windowID; // Store windowID in targetIndex
    self.useVP9Mode = useVP9;
    
    if (useVP9) {
        NSLog(@"🚀 Window capture with High Quality mode enabled");
    } else {
        NSLog(@"📸 Window capture with standard MJPEG mode");
    }
    
    NSLog(@"🎯 About to call setupWindowCapture...");
    [self setupWindowCapture:windowID];
    NSLog(@"🎯 setupWindowCapture returned");
}

- (void)setupWindowCapture:(UInt32)windowID {
    NSLog(@"🚀 Setting up window capture for CGWindowID: %u", windowID);
    
    // Check permissions
    if (!CGPreflightScreenCaptureAccess()) {
        NSLog(@"❌ No screen capture permission!");
        return;
    }
    
    // Stop existing stream immediately to avoid conflicts
    if (self.stream) {
        NSLog(@"⚠️ Stopping existing stream before window capture...");
        SCStream *oldStream = self.stream;
        self.stream = nil;
        self.isCapturing = NO;
        
        [oldStream stopCaptureWithCompletionHandler:^(NSError * _Nullable error) {
            if (error) {
                NSLog(@"❌ Error stopping old stream: %@", error.localizedDescription);
            } else {
                NSLog(@"✅ Old stream stopped successfully");
            }
        }];
        
        // Wait a bit for cleanup
        [NSThread sleepForTimeInterval:0.3];
    }
    
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
            if (error) {
                NSLog(@"❌ Error getting shareable content: %@", error.localizedDescription);
                return;
            }
            
            // Find the window by CGWindowID
            SCWindow *targetWindow = nil;
            for (SCWindow *window in content.windows) {
                if (window.windowID == windowID) {
                    targetWindow = window;
                    break;
                }
            }
            
            SCContentFilter *filter;
            SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
            
            if (!targetWindow) {
                NSLog(@"❌ Window with ID %u not found! Falling back to desktop capture.", windowID);
                // Fallback to desktop if window not found
                if (content.displays.count == 0) {
                    NSLog(@"❌ No displays found!");
                    return;
                }
                SCDisplay *display = content.displays.firstObject;
                filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
                
                // Configure stream for full desktop
                config.width = (int)display.width;
                config.height = (int)display.height;
            } else {
                NSLog(@"✅ Found window: %@ (ID: %u)", targetWindow.title, windowID);
                
                // Bring the window to foreground when starting capture
                dispatch_async(dispatch_get_main_queue(), ^{
                    [self activateWindowIfNeeded:windowID];
                });
                
                // Create filter that shows desktop with menu bar but excludes all other windows
                // This gives a clean view with only the target window visible
                SCDisplay *display = content.displays.firstObject;
                
                // Build list of windows to exclude (all except target)
                NSMutableArray *windowsToExclude = [NSMutableArray array];
                for (SCWindow *window in content.windows) {
                    if (window.windowID != windowID) {
                        [windowsToExclude addObject:window];
                    }
                }
                
                filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:windowsToExclude];
                
                // Configure stream for full desktop to include menu bar
                config.width = (int)display.width;
                config.height = (int)display.height;
                
                NSLog(@"🖥️ Window capture with desktop context: %dx%d (includes menu bar)", 
                      config.width, config.height);
            }
            
            // Common configuration - optimized for ultra-low latency MJPEG
            config.queueDepth = 1; // Minimum queue for lowest latency
            config.pixelFormat = kCVPixelFormatType_32BGRA;
            config.colorSpaceName = kCGColorSpaceSRGB;
            config.showsCursor = YES;
            config.minimumFrameInterval = CMTimeMake(1, 30); // 30 FPS - good balance
            
            // Enable headless capture for locked screens and closed lids
            if (@available(macOS 13.0, *)) {
                config.capturesAudio = NO;
                config.sampleRate = 0;
                config.channelCount = 0;
                // These experimental settings may help with headless capture
                NSLog(@"🔧 Attempting headless window capture configuration...");
            }
            
            NSLog(@"🔧 Configured window stream for headless capture");
            
            // Create new stream on main queue
            dispatch_async(dispatch_get_main_queue(), ^{
                @try {
                    self.stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:self];
                    
                    if (!self.stream) {
                        NSLog(@"❌ Failed to create SCStream!");
                        return;
                    }
                    
                    NSError *streamError;
                    BOOL success = [self.stream addStreamOutput:self type:SCStreamOutputTypeScreen sampleHandlerQueue:self.outputQueue error:&streamError];
                    
                    if (!success || streamError) {
                        NSLog(@"❌ Error adding stream output: %@", streamError.localizedDescription);
                        self.stream = nil;
                        return;
                    }
                    
                    // Start capture
                    [self.stream startCaptureWithCompletionHandler:^(NSError * _Nullable startError) {
                        if (startError) {
                            NSLog(@"❌ Error starting capture: %@", startError.localizedDescription);
                            self.stream = nil;
                        } else {
                            if (targetWindow) {
                                NSLog(@"✅ Window capture started successfully at 30 FPS! Window: %@ (ID: %u)", targetWindow.title, windowID);
                            } else {
                                NSLog(@"✅ Desktop capture started successfully at 30 FPS! (Window %u not found)", windowID);
                            }
                            self.isCapturing = YES;
                        }
                    }];
                } @catch (NSException *exception) {
                    NSLog(@"❌ Exception creating stream: %@", exception);
                    self.stream = nil;
                }
            });
        }];
    });
}

- (void)stopCapture {
    if (self.stream) {
        NSLog(@"🛑 Stopping current capture...");
        [self.stream stopCaptureWithCompletionHandler:^(NSError * _Nullable error) {
            if (error) {
                NSLog(@"❌ Error stopping capture: %@", error.localizedDescription);
            } else {
                NSLog(@"✅ Capture stopped");
            }
        }];
        self.stream = nil;
        self.isCapturing = NO;
        
        // Give it a moment to clean up
        [NSThread sleepForTimeInterval:0.1];
    }
}

- (NSString *)getApplicationsList {
    // Return a simple static response for desktop only
    NSMutableArray *apps = [NSMutableArray array];
    
    // Add full desktop option
    [apps addObject:@{
        @"id": @0, 
        @"name": @"Full Desktop", 
        @"type": @"desktop"
    }];
    
    NSError *jsonError;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:@{@"applications": apps} options:0 error:&jsonError];
    return [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
}

- (NSString *)getWindowsList {
    // Generate fresh windows list each time to avoid caching issues
    NSString *freshList = [self generateWindowsList];
    return freshList ?: @"[]";
}

- (NSString *)generateWindowsList {
    CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    
    if (!windowList) {
        return @"[]";
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
        
        // Skip windows without names or from system processes
        if (windowStr.length == 0 || ownerStr.length == 0) continue;
        
        // Extract bounds
        CGRect bounds;
        if (!CGRectMakeWithDictionaryRepresentation(boundsDict, &bounds)) continue;
        
        // Skip windows that are too small
        if (bounds.size.width < 50 || bounds.size.height < 50) continue;
        
        // Skip certain system windows
        if ([ownerStr isEqualToString:@"WindowServer"] || 
            [ownerStr isEqualToString:@"Dock"] || 
            [ownerStr isEqualToString:@"SystemUIServer"]) continue;
        
        // Get CGWindowID safely
        UInt32 cgWindowID = 0;
        if (cgWindowIDRef) {
            CFNumberGetValue(cgWindowIDRef, kCFNumberSInt32Type, &cgWindowID);
        }
        
        // Limit to 30 windows to avoid browser hanging
        if (windowIdCounter > 30) break;
        
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
            return @"[]";
        }
        
        return [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    } @catch (NSException *exception) {
        return @"[]";
    }
}

#pragma mark - SCStreamDelegate

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    NSLog(@"🚨 Stream stopped with error: %@", error.localizedDescription);
    
    if (error.code == -3801) { // SCStreamErrorDisplayNotFound
        NSLog(@"🔒 Display not available (likely locked/sleeping). Attempting to continue with last frame...");
        
        // Keep serving the last captured frame
        // Don't restart the stream immediately as it may fail again
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            NSLog(@"🔄 Attempting to restart capture after display lock...");
            [self setupCapture];
        });
    } else {
        NSLog(@"❌ Stream error: %ld - %@", (long)error.code, error.localizedDescription);
        
        // Try to restart the stream after a delay
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            NSLog(@"🔄 Attempting to restart stream...");
            [self setupCapture];
        });
    }
}

- (void)streamDidBecomeInvalid:(SCStream *)stream {
    NSLog(@"⚠️ Stream became invalid");
    
    if (stream == self.stream) {
        self.stream = nil;
        self.isCapturing = NO;
        
        // Try to restart after a delay
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            NSLog(@"🔄 Restarting capture after stream invalidation...");
            [self setupCapture];
        });
    }
}

@end

void listApplicationsAndWindows() {
    NSLog(@"🔍 Listing all available applications and windows...");
    
    [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
        if (error) {
            NSLog(@"❌ Error getting shareable content: %@", error.localizedDescription);
            return;
        }
        
        NSLog(@"📱 Available Applications:");
        NSLog(@"0: 📺 FULL DESKTOP (all displays)");
        
        // Filter visible applications
        NSMutableArray *visibleApplications = [NSMutableArray array];
        for (SCRunningApplication *app in content.applications) {
            if (app.applicationName && ![app.applicationName isEqualToString:@""]) {
                [visibleApplications addObject:app];
            }
        }
        
        int index = 1;
        for (SCRunningApplication *app in visibleApplications) {
            NSLog(@"%d: 🚀 %@ (PID: %d)", index, app.applicationName, app.processID);
            index++;
        }
        
        NSLog(@"📂 Available Windows:");
        for (SCWindow *window in content.windows) {
            if (window.title && ![window.title isEqualToString:@""]) {
                SCRunningApplication *ownerApp = window.owningApplication;
                NSString *appName = ownerApp.applicationName ?: @"Unknown";
                NSLog(@"%d: 🪟 %@ - %@ (%.0fx%.0f)", index, appName, window.title, window.frame.size.width, window.frame.size.height);
                index++;
            }
        }
        
        NSLog(@"📝 Usage: ./screencap6 [option]");
        NSLog(@"   ./screencap6           - Full desktop capture (default)");
        NSLog(@"   ./screencap6 list      - Show this list");
        NSLog(@"   ./screencap6 app N     - Capture application N");
        NSLog(@"   ./screencap6 window N  - Capture window N");
        
        exit(0);
    }];
}

// Simple HTTP server
@interface HTTPServer : NSObject
@property (nonatomic, strong) ScreenCapture *captureServer;
@property (nonatomic, assign) int port;
@end

@implementation HTTPServer

- (instancetype)initWithPort:(int)port {
    self = [super init];
    if (self) {
        self.port = port;
        self.captureServer = [[ScreenCapture alloc] init];
    }
    return self;
}

- (void)start {
    NSLog(@"🌐 Starting HTTP server on port %d...", self.port);
    
    // Start default full desktop capture
    [self.captureServer startCaptureWithType:CaptureTypeFullDesktop targetIndex:0];
    
    NSLog(@"📝 API Endpoints:");
    NSLog(@"   GET  /apps           - List applications");
    NSLog(@"   GET  /windows        - List windows (Core Graphics)");
    NSLog(@"   GET  /display        - Get display info (resolution, scaling)");
    NSLog(@"   GET  /frame          - Get current frame (JPEG)");
    NSLog(@"   POST /capture        - Start capture {type, index}");
    NSLog(@"   POST /click          - Send click {x, y}");
    NSLog(@"   POST /click-window   - Send click to window {x, y, cgWindowID}");
    NSLog(@"   POST /click-background - Send click to background window {x, y, cgWindowID}");
    NSLog(@"   POST /key            - Send key {key}");
    NSLog(@"   POST /key-window     - Send key to window {key, cgWindowID}");
    NSLog(@"   POST /key-background - Send key to background window {key, cgWindowID}");
    NSLog(@"   POST /screenshot     - Get window screenshot {cgWindowID}");
    NSLog(@"   POST /stop           - Stop capture");
    
    [self startSocketServer];
}

- (void)startSocketServer {
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        int sockfd = socket(AF_INET, SOCK_STREAM, 0);
        if (sockfd < 0) {
            NSLog(@"❌ Error creating socket");
            return;
        }
        
        int opt = 1;
        setsockopt(sockfd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
        
        struct sockaddr_in server_addr;
        server_addr.sin_family = AF_INET;
        server_addr.sin_addr.s_addr = INADDR_ANY;
        server_addr.sin_port = htons(self.port);
        
        if (bind(sockfd, (struct sockaddr*)&server_addr, sizeof(server_addr)) < 0) {
            NSLog(@"❌ Error binding socket");
            close(sockfd);
            return;
        }
        
        if (listen(sockfd, 5) < 0) {
            NSLog(@"❌ Error listening on socket");
            close(sockfd);
            return;
        }
        
        NSLog(@"✅ HTTP server listening on port %d", self.port);
        
        while (1) {
            struct sockaddr_in client_addr;
            socklen_t client_len = sizeof(client_addr);
            int client_fd = accept(sockfd, (struct sockaddr*)&client_addr, &client_len);
            
            if (client_fd < 0) {
                continue;
            }
            
            dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
                [self handleClient:client_fd];
            });
        }
    });
}

- (void)handleClient:(int)client_fd {
    char buffer[4096];
    ssize_t bytes_read = recv(client_fd, buffer, sizeof(buffer) - 1, 0);
    
    if (bytes_read <= 0) {
        close(client_fd);
        return;
    }
    
    buffer[bytes_read] = '\0';
    NSString *request = [NSString stringWithUTF8String:buffer];
    
    NSArray *lines = [request componentsSeparatedByString:@"\n"];
    if (lines.count == 0) {
        close(client_fd);
        return;
    }
    
    NSString *requestLine = lines[0];
    NSArray *parts = [requestLine componentsSeparatedByString:@" "];
    if (parts.count < 3) {
        close(client_fd);
        return;
    }
    
    NSString *method = parts[0];
    NSString *fullPath = parts[1];
    
    // Strip query string from path (e.g., "/frame?123" -> "/frame")
    NSString *path = [fullPath componentsSeparatedByString:@"?"][0];
    
    // Only log non-GET requests and important GET endpoints to reduce spam
    if (![method isEqualToString:@"GET"] || 
        ([path isEqualToString:@"/"] || [path isEqualToString:@"/windows"])) {
        NSLog(@"📨 %@ %@", method, fullPath);
    }
    
    if ([method isEqualToString:@"GET"] && ([path isEqualToString:@"/"] || [path isEqualToString:@"/index.html"])) {
        [self sendWebUIResponse:client_fd];
    } else if ([method isEqualToString:@"GET"] && [path isEqualToString:@"/apps"]) {
        [self sendAppsListResponse:client_fd];
    } else if ([method isEqualToString:@"GET"] && [path isEqualToString:@"/windows"]) {
        [self sendWindowsListResponse:client_fd];
    } else if ([method isEqualToString:@"GET"] && [path isEqualToString:@"/display"]) {
        [self sendDisplayInfoResponse:client_fd];
    } else if ([method isEqualToString:@"GET"] && [path isEqualToString:@"/frame"]) {
        [self sendFrameResponse:client_fd];
    } else if ([method isEqualToString:@"GET"] && [path isEqualToString:@"/video-stream"]) {
        [self sendVideoStreamResponse:client_fd];
    } else if ([method isEqualToString:@"GET"] && [path isEqualToString:@"/stream.m3u8"]) {
        [self sendHLSPlaylistResponse:client_fd];
    } else if ([method isEqualToString:@"GET"] && [path hasPrefix:@"/segment"]) {
        [self sendHLSSegmentResponse:client_fd path:path];
    } else if ([method isEqualToString:@"GET"] && [path isEqualToString:@"/fps"]) {
        [self sendFPSResponse:client_fd];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/calibrate"]) {
        [self sendCalibrateResponse:client_fd];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/track-click"]) {
        [self handleTrackClickRequest:client_fd request:request];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/click"]) {
        [self handleClickRequest:client_fd request:request];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/click-window"]) {
        [self handleWindowClickRequest:client_fd request:request];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/key"]) {
        [self handleKeyRequest:client_fd request:request];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/key-window"]) {
        [self handleWindowKeyRequest:client_fd request:request];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/capture"]) {
        [self handleCaptureRequest:client_fd request:request];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/capture-window"]) {
        [self handleWindowCaptureRequest:client_fd request:request];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/stop"]) {
        [self.captureServer stopCapture];
        [self sendJSONResponse:client_fd data:@{@"status": @"stopped"}];
    } else if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/screenshot"]) {
        [self handleScreenshotRequest:client_fd request:request];
    } else if ([method isEqualToString:@"OPTIONS"]) {
        [self sendCORSResponse:client_fd];
    } else {
        [self send404Response:client_fd];
    }
    
    close(client_fd);
}

- (void)sendAppsListResponse:(int)client_fd {
    NSString *json = [self.captureServer getApplicationsList];
    NSData *jsonData = [json dataUsingEncoding:NSUTF8StringEncoding];
    
    NSString *headers = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\n\r\n", 
                        (unsigned long)jsonData.length];
    
    send(client_fd, [headers UTF8String], headers.length, 0);
    send(client_fd, jsonData.bytes, jsonData.length, 0);
}

- (void)sendWindowsListResponse:(int)client_fd {
    NSString *json = [self.captureServer getWindowsList];
    NSData *jsonData = [json dataUsingEncoding:NSUTF8StringEncoding];
    
    NSString *headers = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\n\r\n", 
                        (unsigned long)jsonData.length];
    
    // Send headers and body separately to ensure correct Content-Length
    send(client_fd, [headers UTF8String], headers.length, 0);
    send(client_fd, jsonData.bytes, jsonData.length, 0);
}

- (void)sendDisplayInfoResponse:(int)client_fd {
    // Get primary display dimensions
    CGDirectDisplayID displayID = CGMainDisplayID();
    size_t physicalWidth = CGDisplayPixelsWide(displayID);
    size_t physicalHeight = CGDisplayPixelsHigh(displayID);
    
    // Get display bounds (logical coordinates for mouse events)
    CGRect bounds = CGDisplayBounds(displayID);
    
    // For clicks, we need to use the LOGICAL coordinate system, not physical pixels
    size_t clickWidth = (size_t)bounds.size.width;
    size_t clickHeight = (size_t)bounds.size.height;
    
    NSLog(@"🔍 Display info: Physical=%zux%zu, Logical=%.0fx%.0f (for clicks), Scale=%.1fx", 
          physicalWidth, physicalHeight, bounds.size.width, bounds.size.height, (double)physicalWidth/bounds.size.width);
    
    NSDictionary *displayInfo = @{
        @"width": @(clickWidth),        // Use logical coordinates for clicking
        @"height": @(clickHeight),      // Use logical coordinates for clicking
        @"physicalWidth": @(physicalWidth),
        @"physicalHeight": @(physicalHeight),
        @"boundsWidth": @(bounds.size.width),
        @"boundsHeight": @(bounds.size.height),
        @"scaleFactor": @((double)physicalWidth / bounds.size.width)
    };
    
    NSError *jsonError;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:displayInfo options:0 error:&jsonError];
    NSString *json = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    
    NSString *response = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\n\r\n%@", 
                         (unsigned long)jsonData.length, json];
    
    send(client_fd, [response UTF8String], response.length, 0);
}

- (void)sendFrameResponse:(int)client_fd {
    NSData *frameData = [self.captureServer getCurrentFrame];
    
    // Fix: If we have frame data, we must be capturing
    BOOL actuallyCapturing = (frameData.length > 0);
    if (actuallyCapturing && !self.captureServer.isCapturing) {
        self.captureServer.isCapturing = YES;
        NSLog(@"🔧 Fixed isCapturing flag - we have frame data so we must be capturing");
    }
    
    NSTimeInterval frameAge = [[NSDate date] timeIntervalSince1970] - self.captureServer.lastFrameTime;
    
    if (frameData.length == 0) {
        NSLog(@"❌ No frame data available - sending 404");
        [self send404Response:client_fd];
        return;
    }
    
    NSString *header = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\n\r\n", 
                       (unsigned long)frameData.length];
    
    send(client_fd, [header UTF8String], header.length, 0);
    send(client_fd, frameData.bytes, frameData.length, 0);
}

- (void)sendVideoStreamResponse:(int)client_fd {
    NSLog(@"🎬 Video stream request - VP9 mode: %@, capturing: %@", 
          self.captureServer.useVP9Mode ? @"YES" : @"NO",
          self.captureServer.isCapturing ? @"YES" : @"NO");
    
    if (!self.captureServer.useVP9Mode) {
        NSLog(@"❌ Video stream requested but VP9 mode not active");
        [self send404Response:client_fd];
        return;
    }
    
    // For browser compatibility, serve JPEG in video mode but with higher compression
    // VP9/H.264 frames can't be displayed directly in browsers without proper containers
    NSData *frameData = [self.captureServer getCurrentFrame];
    NSLog(@"🎬 Compressed frame data length: %lu", (unsigned long)frameData.length);
    
    if (frameData.length == 0) {
        NSLog(@"❌ No frame data available");
        [self send404Response:client_fd];
        return;
    }
    
    // Serve as JPEG for browser compatibility but indicate it's from video mode
    NSString *header = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nX-Video-Mode: true\r\n\r\n", 
                       (unsigned long)frameData.length];
    
    send(client_fd, [header UTF8String], header.length, 0);
    send(client_fd, frameData.bytes, frameData.length, 0);
    NSLog(@"✅ Video mode frame sent to client");
}

- (void)sendHLSPlaylistResponse:(int)client_fd {
    NSLog(@"📺 HLS playlist request");
    
    if (!self.captureServer.useVP9Mode) {
        NSLog(@"❌ HLS requested but not in video mode");
        [self send404Response:client_fd];
        return;
    }
    
    // Generate M3U8 playlist
    NSString *playlist = [NSString stringWithFormat:@"#EXTM3U\n"
                         @"#EXT-X-VERSION:3\n"
                         @"#EXT-X-TARGETDURATION:2\n"
                         @"#EXT-X-MEDIA-SEQUENCE:%d\n"
                         @"#EXT-X-PLAYLIST-TYPE:EVENT\n"
                         @"#EXTINF:2.0,\n"
                         @"segment%d.ts\n"
                         @"#EXTINF:2.0,\n" 
                         @"segment%d.ts\n"
                         @"#EXTINF:2.0,\n"
                         @"segment%d.ts\n",
                         MAX(0, self.captureServer.currentSegmentIndex - 2),
                         self.captureServer.currentSegmentIndex,
                         self.captureServer.currentSegmentIndex + 1,
                         self.captureServer.currentSegmentIndex + 2];
    
    NSData *playlistData = [playlist dataUsingEncoding:NSUTF8StringEncoding];
    NSString *headers = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\n\r\n",
                        (unsigned long)playlistData.length];
    
    send(client_fd, [headers UTF8String], headers.length, 0);
    send(client_fd, playlistData.bytes, playlistData.length, 0);
    NSLog(@"✅ HLS playlist sent");
}

- (void)sendHLSSegmentResponse:(int)client_fd path:(NSString *)path {
    // NSLog(@"📺 HLS segment request: %@", path); // Removed to reduce spam
    
    if (!self.captureServer.useVP9Mode) {
        NSLog(@"❌ HLS segment requested but not in video mode");
        [self send404Response:client_fd];
        return;
    }
    
    // Get H.264 encoded video data instead of JPEG
    NSData *videoData = [self.captureServer getCurrentVP9Frame];
    
    if (videoData.length == 0) {
        NSLog(@"❌ No H.264/VP9 video data available, falling back to MJPEG");
        // Fallback to MJPEG for now
        NSData *frameData = [self.captureServer getCurrentFrame];
        if (frameData.length == 0) {
            [self send404Response:client_fd];
            return;
        }
        // Serve as MJPEG stream instead of broken TS
        NSString *headers = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\n\r\n",
                            (unsigned long)frameData.length];
        send(client_fd, [headers UTF8String], headers.length, 0);
        send(client_fd, frameData.bytes, frameData.length, 0);
        // NSLog(@"⚠️ HLS segment sent as MJPEG fallback");
        return;
    }
    
    // Serve actual H.264 video data as TS segment
    NSString *headers = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\n\r\n",
                        (unsigned long)videoData.length];
    
    send(client_fd, [headers UTF8String], headers.length, 0);
    send(client_fd, videoData.bytes, videoData.length, 0);
    // NSLog(@"✅ HLS segment sent (H.264 video data)"); // Removed to reduce spam
}

- (void)sendFPSResponse:(int)client_fd {
    float serverFPS = [self.captureServer getCurrentServerFPS];
    
    NSDictionary *fpsData = @{
        @"serverFPS": @(serverFPS),
        @"timestamp": @([[NSDate date] timeIntervalSince1970])
    };
    
    [self sendJSONResponse:client_fd data:fpsData];
}

- (void)sendCalibrateResponse:(int)client_fd {
    NSLog(@"🎯 Manual coordinate calibration requested");
    [self.captureServer calibrateCoordinates];
    
    NSDictionary *calibrationData = @{
        @"status": @"calibrated",
        @"scaleX": @(self.captureServer.coordinateScaleX),
        @"scaleY": @(self.captureServer.coordinateScaleY),
        @"offsetX": @(self.captureServer.coordinateOffsetX),
        @"offsetY": @(self.captureServer.coordinateOffsetY)
    };
    
    [self sendJSONResponse:client_fd data:calibrationData];
}

- (void)handleTrackClickRequest:(int)client_fd request:(NSString *)request {
    NSRange bodyRange = [request rangeOfString:@"\r\n\r\n"];
    if (bodyRange.location == NSNotFound) {
        NSLog(@"❌ Track-click request: No body separator found");
        [self send400Response:client_fd];
        return;
    }
    
    NSString *body = [request substringFromIndex:bodyRange.location + bodyRange.length];
    NSLog(@"📦 Track-click request body: %@", body);
    NSLog(@"📦 Track-click request body length: %lu", (unsigned long)body.length);
    
    NSData *jsonData = [body dataUsingEncoding:NSUTF8StringEncoding];
    
    NSError *error = nil;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    
    if (error || !json) {
        NSLog(@"❌ Track-click JSON parsing error: %@", error ? error.localizedDescription : @"nil result");
        NSLog(@"❌ Body that failed to parse: '%@'", body);
        [self send400Response:client_fd];
        return;
    }
    
    // Extract click tracking data
    NSString *source = json[@"source"] ?: @"unknown";
    NSNumber *timestamp = json[@"timestamp"] ?: @(0);
    NSDictionary *coordinates = json[@"coordinates"];
    NSDictionary *windowInfo = json[@"window_info"];
    
    // Handle both ClickTracker app format and Web Client format
    if (coordinates) {
        // For ClickTracker app format
        NSDictionary *viewCoords = coordinates[@"view"];
        NSDictionary *windowCoords = coordinates[@"window"];
        NSDictionary *screenCoords = coordinates[@"screen"];
        
        if (viewCoords && windowCoords && screenCoords && windowInfo) {
            NSDictionary *windowFrame = windowInfo[@"frame"];
            NSNumber *cgWindowID = windowInfo[@"cgWindowID"];
            
            // Log comprehensive click tracking information
            NSLog(@"CLICK-CALIBRATE: 🎯 CLICK TRACKING from %@:", source);
            NSLog(@"   📍 View: (%.1f, %.1f)", [viewCoords[@"x"] doubleValue], [viewCoords[@"y"] doubleValue]);
            NSLog(@"   🪟 Window: (%.1f, %.1f)", [windowCoords[@"x"] doubleValue], [windowCoords[@"y"] doubleValue]);
            NSLog(@"   🖥️ Screen: (%.1f, %.1f)", [screenCoords[@"x"] doubleValue], [screenCoords[@"y"] doubleValue]);
            NSLog(@"   📏 Window Frame: (%.0f,%.0f) %.0fx%.0f", 
                  [windowFrame[@"x"] doubleValue], [windowFrame[@"y"] doubleValue],
                  [windowFrame[@"width"] doubleValue], [windowFrame[@"height"] doubleValue]);
            NSLog(@"   🆔 CGWindowID: %@", cgWindowID);
            NSLog(@"   ⏰ Timestamp: %.3f", [timestamp doubleValue]);
        } else {
            // For Web Client format
            NSDictionary *clientCoords = coordinates[@"client"];
            if (clientCoords) {
                NSLog(@"CLICK-CALIBRATE: 🎯 CLICK TRACKING from %@:", source);
                NSLog(@"   📍 Client: (%.1f, %.1f)", [clientCoords[@"x"] doubleValue], [clientCoords[@"y"] doubleValue]);
                NSLog(@"   🖥️ Element: %@", coordinates[@"element"] ?: @"unknown");
                NSDictionary *viewport = coordinates[@"viewport"];
                if (viewport) {
                    NSLog(@"   📏 Viewport: %.0fx%.0f", [viewport[@"width"] doubleValue], [viewport[@"height"] doubleValue]);
                }
                if (windowInfo) {
                    NSLog(@"   🆔 CGWindowID: %@", windowInfo[@"cgWindowID"]);
                    NSLog(@"   🎯 Mode: %@", windowInfo[@"capture_mode"]);
                }
                NSLog(@"   ⏰ Timestamp: %.3f", [timestamp doubleValue]);
            }
        }
    }
    
    // Send acknowledgment response
    NSDictionary *response = @{
        @"status": @"tracked",
        @"source": source,
        @"received_at": @([[NSDate date] timeIntervalSince1970])
    };
    
    [self sendJSONResponse:client_fd data:response];
}

- (void)handleClickRequest:(int)client_fd request:(NSString *)request {
    NSRange bodyRange = [request rangeOfString:@"\r\n\r\n"];
    if (bodyRange.location == NSNotFound) {
        NSLog(@"❌ Click request: No body separator found");
        [self send400Response:client_fd];
        return;
    }
    
    NSString *body = [request substringFromIndex:bodyRange.location + bodyRange.length];
    NSLog(@"📦 Click request body: %@", body);
    NSData *jsonData = [body dataUsingEncoding:NSUTF8StringEncoding];
    
    NSError *error = nil;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    
    if (error || !json) {
        NSLog(@"❌ Click JSON parse error: %@", error ? [error description] : @"nil result");
        [self send400Response:client_fd];
        return;
    }
    
    if (!json[@"x"] || !json[@"y"]) {
        NSLog(@"❌ Click request missing x or y: %@", json);
        [self send400Response:client_fd];
        return;
    }
    
    // Handle relative coordinates from browser (0-1000 range representing 0.0-1.0)
    float relativeX = [json[@"x"] floatValue] / 1000.0;  // Convert to 0.0-1.0
    float relativeY = [json[@"y"] floatValue] / 1000.0;  // Convert to 0.0-1.0
    
    // Get actual screen dimensions
    CGDirectDisplayID displayID = CGMainDisplayID();
    CGRect bounds = CGDisplayBounds(displayID);
    
    int x, y;
    
    // For fullscreen desktop capture, map to entire screen including menu bar
    if (self.captureServer.captureType == CaptureTypeFullDesktop) {
        x = (int)(relativeX * bounds.size.width);
        y = (int)(relativeY * bounds.size.height);
        NSLog(@"🖱️ FULLSCREEN Click: relative(%.3f, %.3f) → screen(%d, %d) [full screen: %.0fx%.0f]", 
              relativeX, relativeY, x, y, bounds.size.width, bounds.size.height);
    } else {
        // For window/app capture, exclude menu bar area
        NSScreen *mainScreen = [NSScreen mainScreen];
        CGFloat menuBarHeight = mainScreen.frame.size.height - mainScreen.visibleFrame.size.height;
        CGFloat availableHeight = bounds.size.height - menuBarHeight;
        
        x = (int)(relativeX * bounds.size.width);
        y = (int)(menuBarHeight + (relativeY * availableHeight));
        NSLog(@"🖱️ WINDOW Click: relative(%.3f, %.3f) → screen(%d, %d) [menuBar:%.0f, available:%.0fx%.0f]", 
              relativeX, relativeY, x, y, menuBarHeight, bounds.size.width, availableHeight);
    }
    
    [self.captureServer performClick:x y:y];
    [self sendJSONResponse:client_fd data:@{@"status": @"clicked", @"x": @(x), @"y": @(y)}];
}

- (void)handleKeyRequest:(int)client_fd request:(NSString *)request {
    NSRange bodyRange = [request rangeOfString:@"\r\n\r\n"];
    if (bodyRange.location == NSNotFound) {
        NSLog(@"❌ Key request: No body separator found");
        [self send400Response:client_fd];
        return;
    }
    
    NSString *body = [request substringFromIndex:bodyRange.location + bodyRange.length];
    NSLog(@"📦 Key request body: %@", body);
    NSData *jsonData = [body dataUsingEncoding:NSUTF8StringEncoding];
    
    NSError *error = nil;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    
    if (error || !json) {
        NSLog(@"❌ Key JSON parse error: %@", error ? [error description] : @"nil result");
        [self send400Response:client_fd];
        return;
    }
    
    if (!json[@"key"]) {
        NSLog(@"❌ Key request missing key field: %@", json);
        [self send400Response:client_fd];
        return;
    }
    
    NSString *key = json[@"key"];
    BOOL metaKey = [json[@"metaKey"] boolValue];
    BOOL ctrlKey = [json[@"ctrlKey"] boolValue];
    BOOL altKey = [json[@"altKey"] boolValue];
    BOOL shiftKey = [json[@"shiftKey"] boolValue];
    
    NSLog(@"⌨️ Key press: %@ (cmd:%@, ctrl:%@, alt:%@, shift:%@)", 
          key, metaKey ? @"YES" : @"NO", ctrlKey ? @"YES" : @"NO", 
          altKey ? @"YES" : @"NO", shiftKey ? @"YES" : @"NO");
    
    @try {
        [self.captureServer performKeyPress:key withModifiers:metaKey ctrl:ctrlKey alt:altKey shift:shiftKey];
        [self sendJSONResponse:client_fd data:@{@"status": @"key_pressed", @"key": key}];
        NSLog(@"✅ Key press response sent");
    } @catch (NSException *exception) {
        NSLog(@"❌ Exception in key press: %@", exception);
        [self send500Response:client_fd];
    }
}

- (void)handleWindowClickRequest:(int)client_fd request:(NSString *)request {
    NSRange bodyRange = [request rangeOfString:@"\r\n\r\n"];
    if (bodyRange.location == NSNotFound) {
        NSLog(@"❌ Window click request: No body separator found");
        [self send400Response:client_fd];
        return;
    }
    
    NSString *body = [request substringFromIndex:bodyRange.location + bodyRange.length];
    NSLog(@"📦 Window click request body: %@", body);
    NSData *jsonData = [body dataUsingEncoding:NSUTF8StringEncoding];
    
    NSError *error = nil;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    
    if (error || !json) {
        NSLog(@"❌ Window click JSON parse error: %@", error ? [error description] : @"nil result");
        [self send400Response:client_fd];
        return;
    }
    
    if (!json[@"x"] || !json[@"y"] || !json[@"cgWindowID"]) {
        NSLog(@"❌ Window click request missing x, y, or cgWindowID: %@", json);
        [self send400Response:client_fd];
        return;
    }
    
    // Handle relative coordinates from browser (0-1000 range representing 0.0-1.0)
    float relativeX = [json[@"x"] floatValue] / 1000.0;  // Convert to 0.0-1.0
    float relativeY = [json[@"y"] floatValue] / 1000.0;  // Convert to 0.0-1.0
    UInt32 windowID = [json[@"cgWindowID"] unsignedIntValue];
    
    // Get actual screen dimensions - since window capture now includes full desktop
    CGDirectDisplayID displayID = CGMainDisplayID();
    CGRect bounds = CGDisplayBounds(displayID);
    
    // Convert relative coordinates to absolute screen coordinates
    // Window capture now shows full screen including menu bar, so use same mapping as fullscreen
    int x = (int)(relativeX * bounds.size.width);
    int y = (int)(relativeY * bounds.size.height);
    
    NSLog(@"🖱️ WINDOW Click: relative(%.3f, %.3f) → screen(%d, %d) targeting window %u [full desktop: %.0fx%.0f]", 
          relativeX, relativeY, x, y, windowID, bounds.size.width, bounds.size.height);
    
    @try {
        [self.captureServer performClick:x y:y targetWindowID:windowID];
        [self sendJSONResponse:client_fd data:@{@"status": @"clicked", @"x": @(x), @"y": @(y), @"cgWindowID": @(windowID)}];
        NSLog(@"✅ Window click response sent");
    } @catch (NSException *exception) {
        NSLog(@"❌ Exception in window click: %@", exception);
        [self send500Response:client_fd];
    }
}

- (void)handleWindowKeyRequest:(int)client_fd request:(NSString *)request {
    NSRange bodyRange = [request rangeOfString:@"\r\n\r\n"];
    if (bodyRange.location == NSNotFound) {
        NSLog(@"❌ Window key request: No body separator found");
        [self send400Response:client_fd];
        return;
    }
    
    NSString *body = [request substringFromIndex:bodyRange.location + bodyRange.length];
    NSLog(@"📦 Window key request body: %@", body);
    NSData *jsonData = [body dataUsingEncoding:NSUTF8StringEncoding];
    
    NSError *error = nil;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    
    if (error || !json) {
        NSLog(@"❌ Window key JSON parse error: %@", error ? [error description] : @"nil result");
        [self send400Response:client_fd];
        return;
    }
    
    if (!json[@"key"] || !json[@"cgWindowID"]) {
        NSLog(@"❌ Window key request missing key or cgWindowID: %@", json);
        [self send400Response:client_fd];
        return;
    }
    
    NSString *key = json[@"key"];
    UInt32 windowID = [json[@"cgWindowID"] unsignedIntValue];
    BOOL metaKey = [json[@"metaKey"] boolValue];
    BOOL ctrlKey = [json[@"ctrlKey"] boolValue];
    BOOL altKey = [json[@"altKey"] boolValue];
    BOOL shiftKey = [json[@"shiftKey"] boolValue];
    
    NSLog(@"⌨️ Window key press: %@ targeting window %u (cmd:%@, ctrl:%@, alt:%@, shift:%@)", 
          key, windowID, metaKey ? @"YES" : @"NO", ctrlKey ? @"YES" : @"NO", 
          altKey ? @"YES" : @"NO", shiftKey ? @"YES" : @"NO");
    
    @try {
        [self.captureServer performKeyPress:key withModifiers:metaKey ctrl:ctrlKey alt:altKey shift:shiftKey targetWindowID:windowID];
        [self sendJSONResponse:client_fd data:@{@"status": @"key_pressed", @"key": key, @"cgWindowID": @(windowID)}];
        NSLog(@"✅ Window key press response sent");
    } @catch (NSException *exception) {
        NSLog(@"❌ Exception in window key press: %@", exception);
        [self send500Response:client_fd];
    }
}

- (void)handleCaptureRequest:(int)client_fd request:(NSString *)request {
    NSRange bodyRange = [request rangeOfString:@"\r\n\r\n"];
    if (bodyRange.location == NSNotFound) {
        [self send400Response:client_fd];
        return;
    }
    
    NSString *body = [request substringFromIndex:bodyRange.location + bodyRange.length];
    NSData *jsonData = [body dataUsingEncoding:NSUTF8StringEncoding];
    
    NSError *error = nil;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    
    if (error) {
        [self send400Response:client_fd];
        return;
    }
    
    int type = [json[@"type"] intValue]; // 0=desktop, 1=app
    int index = [json[@"index"] intValue];
    BOOL vp9Mode = [json[@"vp9"] boolValue]; // VP9 hardware acceleration
    
    [self.captureServer stopCapture];
    [self.captureServer startCaptureWithType:type targetIndex:index vp9Mode:vp9Mode];
    
    NSString *modeStr = vp9Mode ? @"VP9" : @"Standard";
    [self sendJSONResponse:client_fd data:@{
        @"status": @"capture_started", 
        @"type": @(type), 
        @"index": @(index),
        @"mode": modeStr
    }];
}

- (void)handleWindowCaptureRequest:(int)client_fd request:(NSString *)request {
    NSRange bodyRange = [request rangeOfString:@"\r\n\r\n"];
    if (bodyRange.location == NSNotFound) {
        NSLog(@"❌ No body separator found in request");
        [self send400Response:client_fd];
        return;
    }
    
    NSString *body = [request substringFromIndex:bodyRange.location + bodyRange.length];
    NSLog(@"📦 Request body: %@", body);
    NSData *jsonData = [body dataUsingEncoding:NSUTF8StringEncoding];
    
    NSError *error = nil;
    NSDictionary *json = nil;
    
    @try {
        json = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    } @catch (NSException *exception) {
        NSLog(@"❌ Exception parsing JSON: %@", exception);
        [self send400Response:client_fd];
        return;
    }
    
    if (error || !json) {
        NSLog(@"❌ JSON parse error: %@", error ? error.localizedDescription : @"nil result");
        [self send400Response:client_fd];
        return;
    }
    
    NSLog(@"📌 Parsed JSON successfully: %@", json);
    
    if (!json[@"cgWindowID"]) {
        NSLog(@"❌ No cgWindowID in JSON: %@", json);
        [self send400Response:client_fd];
        return;
    }
    
    NSLog(@"📌 About to extract windowID from JSON...");
    id windowIDValue = json[@"cgWindowID"];
    NSLog(@"📌 windowID value type: %@, value: %@", [windowIDValue class], windowIDValue);
    
    UInt32 windowID = 0;
    if ([windowIDValue isKindOfClass:[NSNumber class]]) {
        windowID = [windowIDValue unsignedIntValue];
    } else {
        NSLog(@"❌ cgWindowID is not a number!");
        [self send400Response:client_fd];
        return;
    }
    
    BOOL vp9Mode = [json[@"vp9"] boolValue]; // VP9 hardware acceleration
    
    NSLog(@"🪟 Window selection request: CGWindowID %u, HQ: %@", windowID, vp9Mode ? @"YES" : @"NO");
    
    if (!self.captureServer) {
        NSLog(@"❌ Capture server not initialized!");
        [self send500Response:client_fd];
        return;
    }
    
    NSLog(@"📌 Capture server exists, stopping current capture...");
    
    // Stop current capture and start window-specific capture
    @try {
        [self.captureServer stopCapture];
        NSLog(@"📌 Stop capture completed, starting window capture...");
        
        [self.captureServer startCaptureWithWindowID:windowID vp9Mode:vp9Mode];
        NSLog(@"📌 Window capture started successfully");
        
        NSString *modeStr = vp9Mode ? @"VP9" : @"Standard";
        [self sendJSONResponse:client_fd data:@{
            @"status": @"window_capture_started", 
            @"cgWindowID": @(windowID),
            @"mode": modeStr
        }];
        NSLog(@"📌 Response sent to client");
    } @catch (NSException *exception) {
        NSLog(@"❌ Exception in window capture: %@", exception);
        [self send500Response:client_fd];
    }
}

- (void)handleScreenshotRequest:(int)client_fd request:(NSString *)request {
    NSRange bodyRange = [request rangeOfString:@"\r\n\r\n"];
    if (bodyRange.location == NSNotFound) {
        [self send400Response:client_fd];
        return;
    }
    
    NSString *body = [request substringFromIndex:bodyRange.location + bodyRange.length];
    NSData *jsonData = [body dataUsingEncoding:NSUTF8StringEncoding];
    
    NSError *error = nil;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    
    if (error || !json[@"cgWindowID"]) {
        [self send400Response:client_fd];
        return;
    }
    
    UInt32 windowID = [json[@"cgWindowID"] unsignedIntValue];
    NSLog(@"📸 Taking screenshot of window %u using screencapture command", windowID);
    
    // Use system screencapture command - simple and always works
    NSString *tempFile = [NSString stringWithFormat:@"/tmp/window_%u.jpg", windowID];
    NSString *command = [NSString stringWithFormat:@"/usr/sbin/screencapture -l %u -t jpg '%@'", windowID, tempFile];
    
    int result = system([command UTF8String]);
    
    if (result != 0) {
        NSLog(@"❌ screencapture command failed for window %u", windowID);
        [self send500Response:client_fd];
        return;
    }
    
    // Read the captured file
    NSData *jpegData = [NSData dataWithContentsOfFile:tempFile];
    
    // Clean up temp file
    [[NSFileManager defaultManager] removeItemAtPath:tempFile error:nil];
    
    if (!jpegData || jpegData.length == 0) {
        NSLog(@"❌ Failed to read screenshot file for window %u", windowID);
        [self send500Response:client_fd];
        return;
    }
    
    // Convert to base64
    NSString *base64String = [jpegData base64EncodedStringWithOptions:0];
    NSString *dataURL = [NSString stringWithFormat:@"data:image/jpeg;base64,%@", base64String];
    
    NSLog(@"✅ Window screenshot captured: %lu bytes", jpegData.length);
    [self sendJSONResponse:client_fd data:@{@"screenshot": dataURL, @"cgWindowID": @(windowID)}];
}

- (void)sendJSONResponse:(int)client_fd data:(NSDictionary *)data {
    NSError *error = nil;
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:data options:0 error:&error];
    
    NSString *headers = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %lu\r\nAccess-Control-Allow-Origin: *\r\n\r\n", 
                        (unsigned long)jsonData.length];
    
    send(client_fd, [headers UTF8String], headers.length, 0);
    send(client_fd, jsonData.bytes, jsonData.length, 0);
}

- (void)send404Response:(int)client_fd {
    NSString *response = @"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found";
    send(client_fd, [response UTF8String], response.length, 0);
}

- (void)send400Response:(int)client_fd {
    NSString *response = @"HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request";
    send(client_fd, [response UTF8String], response.length, 0);
}

- (void)send500Response:(int)client_fd {
    NSString *response = @"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 21\r\n\r\nInternal Server Error";
    send(client_fd, [response UTF8String], response.length, 0);
}

- (void)sendCORSResponse:(int)client_fd {
    NSString *response = @"HTTP/1.1 200 OK\r\n"
                         @"Access-Control-Allow-Origin: *\r\n"
                         @"Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                         @"Access-Control-Allow-Headers: Content-Type\r\n"
                         @"Content-Length: 0\r\n\r\n";
    send(client_fd, [response UTF8String], response.length, 0);
}

- (void)sendWebUIResponse:(int)client_fd {
    NSString *html = @"<!DOCTYPE html>\n"
                     @"<html>\n"
                     @"<head>\n"
                     @"    <title>Remote Desktop</title>\n"
                     @"    <meta charset=\"utf-8\">\n"
                     @"    <script src=\"https://cdn.jsdelivr.net/npm/hls.js@latest\"></script>\n"
                     @"    <style>\n"
                     @"        body { margin: 0; padding: 20px; font-family: Arial, sans-serif; background: #1a1a1a; color: white; }\n"
                     @"        .controls { margin-bottom: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }\n"
                     @"        button { padding: 8px 16px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; cursor: pointer; }\n"
                     @"        button:hover { background: #444; }\n"
                     @"        button.active { background: #0066cc; }\n"
                     @"        select { padding: 8px; background: #333; color: white; border: 1px solid #555; border-radius: 4px; }\n"
                     @"        .status { padding: 10px; background: #333; border-radius: 4px; margin-bottom: 10px; }\n"
                     @"        .screen-container { position: relative; border: 1px solid #555; background: #000; max-height: 80vh; overflow: hidden; }\n"
                     @"        .screen { max-width: 100%; max-height: 80vh; width: auto; height: auto; object-fit: contain; display: block; cursor: crosshair; }\n"
                     @"        .loading { text-align: center; padding: 50px; color: #888; }\n"
                     @"    </style>\n"
                     @"</head>\n"
                     @"<body>\n"
                     @"    <h1>Remote Desktop Control</h1>\n"
                     @"    \n"
                     @"    <div class=\"controls\">\n"
                     @"        <button id=\"start-btn\" onclick=\"startCapture()\">Start Capture</button>\n"
                     @"        <select id=\"window-select\" onchange=\"switchToWindow()\">\n"
                     @"            <option value=\"0\">Full Desktop</option>\n"
                     @"        </select>\n"
                     @"        <button onclick=\"refreshWindows()\">Refresh Windows</button>\n"
                     @"        <button onclick=\"calibrateCoordinates()\" style=\"background: #660066;\">🎯 Calibrate Mouse</button>\n"
                     @"    </div>\n"
                     @"    \n"
                     @"    <div class=\"status\" id=\"status\">Ready to start capture</div>\n"
                     @"    <div class=\"status\" id=\"fps-display\" style=\"background: #222; font-family: monospace; display: none;\">\n"
                     @"        Server: <span id=\"server-fps\">0</span>fps | Client: <span id=\"client-fps\">0</span>fps | Latency: <span id=\"network-latency\">0</span>ms | Poll Rate: <span id=\"poll-rate\">0</span>ms\n"
                     @"    </div>\n"
                     @"    \n"
                     @"    <div class=\"screen-container\">\n"
                     @"        <img id=\"screen\" class=\"screen\" onclick=\"handleClick(event)\" onload=\"onFrameLoad()\" style=\"display: none;\">\n"
                     @"        <video id=\"video\" class=\"screen\" onclick=\"handleClick(event)\" autoplay muted style=\"display: none;\"></video>\n"
                     @"        <div id=\"loading\" class=\"loading\">Click 'Start Desktop Capture' to begin</div>\n"
                     @"    </div>\n"
                     @"    \n"
                     @"    <script>\n"
                     @"        let isCapturing = false;\n"
                     @"        let pollInterval = null;\n"
                     @"        let currentWindowId = 0;\n"
                     @"        let windows = [];\n"
                     @"        \n"
                     @"        // FPS tracking\n"
                     @"        let lastFrameTime = 0;\n"
                     @"        let clientFPS = 0;\n"
                     @"        let frameCount = 0;\n"
                     @"        let fpsInterval = null;\n"
                     @"        let lastFrameHash = '';\n"
                     @"        let uniqueFrameCount = 0;\n"
                     @"        let fpsStartTime = 0;\n"
                     @"        let networkLatency = 0;\n"
                     @"        \n"
                     @"        function setStatus(msg) {\n"
                     @"            document.getElementById('status').textContent = msg;\n"
                     @"        }\n"
                     @"        \n"
                     @"        async function updateClientFPS(frameData) {\n"
                     @"            const currentTime = performance.now();\n"
                     @"            \n"
                     @"            // Generate simple hash of frame data to detect unique frames\n"
                     @"            let frameHash = '';\n"
                     @"            if (frameData && frameData.size) {\n"
                     @"                frameHash = frameData.size + '_' + frameData.type;\n"
                     @"            } else {\n"
                     @"                // For video or other sources, use timestamp\n"
                     @"                frameHash = Math.floor(currentTime / 100) + ''; // 100ms precision\n"
                     @"            }\n"
                     @"            \n"
                     @"            // Only count unique frames\n"
                     @"            if (frameHash !== lastFrameHash) {\n"
                     @"                lastFrameHash = frameHash;\n"
                     @"                uniqueFrameCount++;\n"
                     @"                \n"
                     @"                // Initialize timing\n"
                     @"                if (fpsStartTime === 0) {\n"
                     @"                    fpsStartTime = currentTime;\n"
                     @"                }\n"
                     @"                \n"
                     @"                // Calculate FPS over 1 second window\n"
                     @"                const windowDuration = currentTime - fpsStartTime;\n"
                     @"                if (windowDuration >= 1000) { // 1 second\n"
                     @"                    clientFPS = (uniqueFrameCount * 1000) / windowDuration;\n"
                     @"                    document.getElementById('client-fps').textContent = clientFPS.toFixed(1);\n"
                     @"                    \n"
                     @"                    // Reset counters\n"
                     @"                    fpsStartTime = currentTime;\n"
                     @"                    uniqueFrameCount = 0;\n"
                     @"                }\n"
                     @"            }\n"
                     @"        }\n"
                     @"        \n"
                     @"        function startFPSMonitoring() {\n"
                     @"            document.getElementById('fps-display').style.display = 'block';\n"
                     @"            \n"
                     @"            // Reset FPS counters\n"
                     @"            lastFrameHash = '';\n"
                     @"            uniqueFrameCount = 0;\n"
                     @"            fpsStartTime = 0;\n"
                     @"            clientFPS = 0;\n"
                     @"            \n"
                     @"            // Update server FPS every second\n"
                     @"            fpsInterval = setInterval(async () => {\n"
                     @"                try {\n"
                     @"                    const response = await fetch('/fps');\n"
                     @"                    if (response.ok) {\n"
                     @"                        const data = await response.json();\n"
                     @"                        document.getElementById('server-fps').textContent = data.serverFPS.toFixed(1);\n"
                     @"                    }\n"
                     @"                } catch (e) {\n"
                     @"                    console.error('FPS fetch error:', e);\n"
                     @"                }\n"
                     @"            }, 1000);\n"
                     @"        }\n"
                     @"        \n"
                     @"        function stopFPSMonitoring() {\n"
                     @"            document.getElementById('fps-display').style.display = 'none';\n"
                     @"            if (fpsInterval) {\n"
                     @"                clearInterval(fpsInterval);\n"
                     @"                fpsInterval = null;\n"
                     @"            }\n"
                     @"        }\n"
                     @"        \n"
                     @"        async function startCapture() {\n"
                     @"            try {\n"
                     @"                setStatus('Starting capture...');\n"
                     @"                \n"
                     @"                let response;\n"
                     @"                if (currentWindowId === 0) {\n"
                     @"                    // Desktop capture\n"
                     @"                    response = await fetch('/capture', {\n"
                     @"                        method: 'POST',\n"
                     @"                        headers: { 'Content-Type': 'application/json' },\n"
                     @"                        body: JSON.stringify({\n"
                     @"                            type: 0,\n"
                     @"                            index: 0,\n"
                     @"                            vp9: true\n"
                     @"                        })\n"
                     @"                    });\n"
                     @"                } else {\n"
                     @"                    // Window capture\n"
                     @"                    response = await fetch('/capture-window', {\n"
                     @"                        method: 'POST',\n"
                     @"                        headers: { 'Content-Type': 'application/json' },\n"
                     @"                        body: JSON.stringify({\n"
                     @"                            cgWindowID: getCGWindowID(currentWindowId),\n"
                     @"                            vp9: true\n"
                     @"                        })\n"
                     @"                    });\n"
                     @"                }\n"
                     @"                \n"
                     @"                if (response.ok) {\n"
                     @"                    isCapturing = true;\n"
                     @"                    document.getElementById('start-btn').textContent = 'Stop Capture';\n"
                     @"                    document.getElementById('start-btn').onclick = stopCapture;\n"
                     @"                    document.getElementById('loading').style.display = 'none';\n"
                     @"                    \n"
                     @"                    // Show the screen element and start polling\n"
                     @"                    document.getElementById('video').style.display = 'none';\n"
                     @"                    document.getElementById('screen').style.display = 'block';\n"
                     @"                    \n"
                     @"                    startPolling();\n"
                     @"                    \n"
                     @"                    setStatus('Capture active - High Quality MJPEG');\n"
                     @"                    startFPSMonitoring();\n"
                     @"                } else {\n"
                     @"                    setStatus('Failed to start capture');\n"
                     @"                }\n"
                     @"            } catch (e) {\n"
                     @"                setStatus('Error: ' + e.message);\n"
                     @"            }\n"
                     @"        }\n"
                     @"        \n"
                     @"        function stopCapture() {\n"
                     @"            isCapturing = false;\n"
                     @"            if (pollInterval) {\n"
                     @"                clearInterval(pollInterval);\n"
                     @"                pollInterval = null;\n"
                     @"            }\n"
                     @"            document.getElementById('start-btn').textContent = 'Start Capture';\n"
                     @"            document.getElementById('start-btn').onclick = startCapture;\n"
                     @"            document.getElementById('screen').style.display = 'none';\n"
                     @"            document.getElementById('video').style.display = 'none';\n"
                     @"            document.getElementById('loading').style.display = 'block';\n"
                     @"            stopFPSMonitoring();\n"
                     @"            setStatus('Capture stopped');\n"
                     @"        }\n"
                     @"        \n"
                     @"        function startPolling() {\n"
                     @"            if (pollInterval) clearInterval(pollInterval);\n"
                     @"            \n"
                     @"            pollInterval = setInterval(async () => {\n"
                     @"                if (!isCapturing) return;\n"
                     @"                \n"
                     @"                try {\n"
                     @"                    const startTime = performance.now();\n"
                     @"                    const response = await fetch('/frame?' + Date.now());\n"
                     @"                    const endTime = performance.now();\n"
                     @"                    \n"
                     @"                    if (response.ok) {\n"
                     @"                        const frameBlob = await response.blob();\n"
                     @"                        const imageUrl = URL.createObjectURL(frameBlob);\n"
                     @"                        const oldUrl = document.getElementById('screen').src;\n"
                     @"                        document.getElementById('screen').src = imageUrl;\n"
                     @"                        if (oldUrl && oldUrl.startsWith('blob:')) {\n"
                     @"                            URL.revokeObjectURL(oldUrl);\n"
                     @"                        }\n"
                     @"                        \n"
                     @"                        // Update metrics\n"
                     @"                        networkLatency = endTime - startTime;\n"
                     @"                        document.getElementById('network-latency').textContent = networkLatency.toFixed(1);\n"
                     @"                        document.getElementById('poll-rate').textContent = '33';\n"
                     @"                        await updateClientFPS(frameBlob);\n"
                     @"                    }\n"
                     @"                } catch (e) {\n"
                     @"                    console.error('Frame fetch error:', e);\n"
                     @"                    setStatus('Connection error - retrying...');\n"
                     @"                }\n"
                     @"            }, 33);\n"
                     @"        }\n"
                     @"        \n"
                     @"        function onFrameLoad() {\n"
                     @"            if (isCapturing) {\n"
                     @"                setStatus('Capture active - High Quality MJPEG');\n"
                     @"            }\n"
                     @"        }\n"
                     @"        \n"
                     @"        let realScreenWidth = 3840;\n"
                     @"        let realScreenHeight = 1620;\n"
                     @"        \n"
                     @"        // Fetch actual screen dimensions from server\n"
                     @"        async function fetchRealDimensions() {\n"
                     @"            try {\n"
                     @"                const response = await fetch('/display');\n"
                     @"                const data = await response.json();\n"
                     @"                realScreenWidth = data.width;\n"
                     @"                realScreenHeight = data.height;\n"
                     @"                console.log('📐 Real screen dimensions:', realScreenWidth, 'x', realScreenHeight);\n"
                     @"            } catch (e) {\n"
                     @"                console.warn('⚠️ Could not fetch screen dimensions, using defaults');\n"
                     @"            }\n"
                     @"        }\n"
                     @"        \n"
                     @"        async function handleClick(event) {\n"
                     @"            // Get the image/video element bounds\n"
                     @"            const rect = event.target.getBoundingClientRect();\n"
                     @"            \n"
                     @"            // Calculate click position relative to the image element's top-left corner\n"
                     @"            // This gives us the exact pixel position within the image bounds\n"
                     @"            const imageClickX = event.clientX - rect.left;\n"
                     @"            const imageClickY = event.clientY - rect.top;\n"
                     @"            \n"
                     @"            // Ensure coordinates are within image bounds (clamp to prevent out-of-bounds)\n"
                     @"            const clampedX = Math.max(0, Math.min(imageClickX, rect.width));\n"
                     @"            const clampedY = Math.max(0, Math.min(imageClickY, rect.height));\n"
                     @"            \n"
                     @"            // Convert to normalized coordinates (0.0 to 1.0) within the image\n"
                     @"            const relativeX = clampedX / rect.width;\n"
                     @"            const relativeY = clampedY / rect.height;\n"
                     @"            \n"
                     @"            // NEW APPROACH: Send relative coordinates (0.0-1.0) and let server handle transformation\n"
                     @"            // This eliminates all client-side coordinate system assumptions\n"
                     @"            const x = Math.round(relativeX * 1000); // Convert to 0-1000 range for precision\n"
                     @"            const y = Math.round(relativeY * 1000);\n"
                     @"            \n"
                     @"            console.log('🔍 COORDINATE MAPPING:');\n"
                     @"            console.log('  Browser click: (', event.clientX, ',', event.clientY, ')');\n"
                     @"            console.log('  Image rect: ', rect.width, 'x', rect.height, ' at (', rect.left, ',', rect.top, ')');\n"
                     @"            console.log('  NEW RELATIVE APPROACH: sending 0-1000 range to server');\n"
                     @"            console.log('  Image-relative click: (', imageClickX.toFixed(1), ',', imageClickY.toFixed(1), ')');\n"
                     @"            console.log('  Normalized (0-1): (', relativeX.toFixed(3), ',', relativeY.toFixed(3), ')');\n"
                     @"            console.log('  Final coords (0-1000): (', x, ',', y, ')');\n"
                     @"            \n"
                     @"            try {\n"
                     @"                const endpoint = currentWindowId === 0 ? '/click' : '/click-window';\n"
                     @"                const body = currentWindowId === 0 ? \n"
                     @"                    { x: x, y: y } : \n"
                     @"                    { x: x, y: y, cgWindowID: getCGWindowID(currentWindowId) };\n"
                     @"                \n"
                     @"                await fetch(endpoint, {\n"
                     @"                    method: 'POST',\n"
                     @"                    headers: { 'Content-Type': 'application/json' },\n"
                     @"                    body: JSON.stringify(body)\n"
                     @"                });\n"
                     @"                \n"
                     @"                // Send click tracking data\n"
                     @"                await fetch('/track-click', {\n"
                     @"                    method: 'POST',\n"
                     @"                    headers: { 'Content-Type': 'application/json' },\n"
                     @"                    body: JSON.stringify({\n"
                     @"                        event: 'click_tracking',\n"
                     @"                        source: 'Web_Client',\n"
                     @"                        timestamp: Date.now() / 1000,\n"
                     @"                        coordinates: {\n"
                     @"                            client: { x: x, y: y },\n"
                     @"                            element: event.target.tagName,\n"
                     @"                            viewport: { width: window.innerWidth, height: window.innerHeight }\n"
                     @"                        },\n"
                     @"                        window_info: {\n"
                     @"                            cgWindowID: currentWindowId === 0 ? 0 : getCGWindowID(currentWindowId),\n"
                     @"                            capture_mode: currentWindowId === 0 ? 'fullscreen' : 'window'\n"
                     @"                        }\n"
                     @"                    })\n"
                     @"                });\n"
                     @"                \n"
                     @"                setStatus('Clicked at (' + x + ', ' + y + ')');\n"
                     @"            } catch (e) {\n"
                     @"                setStatus('Click error: ' + e.message);\n"
                     @"            }\n"
                     @"        }\n"
                     @"        \n"
                     @"        document.addEventListener('keydown', async (event) => {\n"
                     @"            if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;\n"
                     @"            if (!isCapturing) return;\n"
                     @"            \n"
                     @"            event.preventDefault();\n"
                     @"            \n"
                     @"            try {\n"
                     @"                const endpoint = currentWindowId === 0 ? '/key' : '/key-window';\n"
                     @"                const body = currentWindowId === 0 ? \n"
                     @"                    { key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey } : \n"
                     @"                    { key: event.key, cgWindowID: getCGWindowID(currentWindowId), metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey };\n"
                     @"                \n"
                     @"                await fetch(endpoint, {\n"
                     @"                    method: 'POST',\n"
                     @"                    headers: { 'Content-Type': 'application/json' },\n"
                     @"                    body: JSON.stringify(body)\n"
                     @"                });\n"
                     @"            } catch (e) {\n"
                     @"                console.error('Key error:', e);\n"
                     @"            }\n"
                     @"        });\n"
                     @"        \n"
                     @"        async function refreshWindows() {\n"
                     @"            try {\n"
                     @"                const response = await fetch('/windows');\n"
                     @"                if (response.ok) {\n"
                     @"                    windows = await response.json();\n"
                     @"                    updateWindowSelect();\n"
                     @"                    setStatus('Windows refreshed');\n"
                     @"                }\n"
                     @"            } catch (e) {\n"
                     @"                setStatus('Error refreshing windows: ' + e.message);\n"
                     @"            }\n"
                     @"        }\n"
                     @"        \n"
                     @"        function updateWindowSelect() {\n"
                     @"            const select = document.getElementById('window-select');\n"
                     @"            select.innerHTML = '<option value=\"0\">Full Desktop</option>';\n"
                     @"            \n"
                     @"            windows.forEach(window => {\n"
                     @"                const option = document.createElement('option');\n"
                     @"                option.value = window.id;\n"
                     @"                option.textContent = window.app + ' - ' + window.title;\n"
                     @"                select.appendChild(option);\n"
                     @"            });\n"
                     @"        }\n"
                     @"        \n"
                     @"        function switchToWindow() {\n"
                     @"            const select = document.getElementById('window-select');\n"
                     @"            currentWindowId = parseInt(select.value);\n"
                     @"            \n"
                     @"            if (isCapturing) {\n"
                     @"                startCapture();\n"
                     @"            }\n"
                     @"        }\n"
                     @"        \n"
                     @"        function getCGWindowID(windowId) {\n"
                     @"            if (windowId === 0) return 0;\n"
                     @"            const window = windows.find(w => w.id === windowId);\n"
                     @"            return window ? window.cgWindowID : 0;\n"
                     @"        }\n"
                     @"        \n"
                     @"        async function calibrateCoordinates() {\n"
                     @"            try {\n"
                     @"                setStatus('🎯 Calibrating mouse coordinates...');\n"
                     @"                const response = await fetch('/calibrate', { method: 'POST' });\n"
                     @"                if (response.ok) {\n"
                     @"                    const data = await response.json();\n"
                     @"                    setStatus(`✅ Calibrated! Scale: ${data.scaleX.toFixed(3)}x${data.scaleY.toFixed(3)}, Offset: ${data.offsetX.toFixed(1)},${data.offsetY.toFixed(1)}`);\n"
                     @"                } else {\n"
                     @"                    setStatus('❌ Calibration failed');\n"
                     @"                }\n"
                     @"            } catch (e) {\n"
                     @"                setStatus('❌ Calibration error: ' + e.message);\n"
                     @"            }\n"
                     @"        }\n"
                     @"        \n"
                     @"        // Initialize\n"
                     @"        refreshWindows();\n"
                     @"        fetchRealDimensions();\n"
                     @"    </script>\n"
                     @"</body>\n"
                     @"</html>";
    
    NSData *htmlData = [html dataUsingEncoding:NSUTF8StringEncoding];
    NSString *headers = [NSString stringWithFormat:@"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: %lu\r\n\r\n", 
                        (unsigned long)htmlData.length];
    
    send(client_fd, [headers UTF8String], headers.length, 0);
    send(client_fd, htmlData.bytes, htmlData.length, 0);
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSLog(@"🔥 ScreenCaptureKit HTTP Server v7 Starting...");
        
        int port = 8080;
        if (argc > 1) {
            port = atoi(argv[1]);
        }
        
        BOOL hasScreenPermission = CGPreflightScreenCaptureAccess();
        BOOL hasAccessibilityPermission = AXIsProcessTrusted();
        
        NSLog(@"📋 Permission Status:");
        NSLog(@"   Screen Recording: %@", hasScreenPermission ? @"✅ GRANTED" : @"❌ DENIED");
        NSLog(@"   Accessibility: %@", hasAccessibilityPermission ? @"✅ GRANTED" : @"❌ DENIED");
        
        if (!hasScreenPermission) {
            NSLog(@"🔒 Screen recording permission required!");
            CGRequestScreenCaptureAccess();
        }
        
        HTTPServer *server = [[HTTPServer alloc] initWithPort:port];
        [server start];
        
        [[NSRunLoop currentRunLoop] run];
    }
    return 0;
}