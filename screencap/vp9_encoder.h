#import <Foundation/Foundation.h>
#import <VideoToolbox/VideoToolbox.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>

@interface VP9Encoder : NSObject

@property (nonatomic, assign) BOOL isInitialized;
@property (nonatomic, assign) VTCompressionSessionRef compressionSession;
@property (nonatomic, strong) NSMutableData *encodedData;
@property (nonatomic, assign) dispatch_semaphore_t encodingSemaphore;

- (instancetype)initWithWidth:(int)width height:(int)height;
- (NSData *)encodeFrame:(CVPixelBufferRef)pixelBuffer;
- (void)cleanup;

@end