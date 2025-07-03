#import "vp9_encoder.h"

// Compression output callback
void compressionOutputCallback(void *outputCallbackRefCon,
                              void *sourceFrameRefCon,
                              OSStatus status,
                              VTEncodeInfoFlags infoFlags,
                              CMSampleBufferRef sampleBuffer) {
    
    VP9Encoder *encoder = (__bridge VP9Encoder *)outputCallbackRefCon;
    
    if (status != noErr) {
        NSLog(@"❌ VP9 encoding error: %d", (int)status);
        dispatch_semaphore_signal(encoder.encodingSemaphore);
        return;
    }
    
    if (!sampleBuffer) {
        NSLog(@"❌ VP9 encoding: No sample buffer");
        dispatch_semaphore_signal(encoder.encodingSemaphore);
        return;
    }
    
    // Get the encoded data
    CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
    if (blockBuffer) {
        size_t totalLength = CMBlockBufferGetDataLength(blockBuffer);
        
        // Reset the encoded data buffer
        [encoder.encodedData setLength:0];
        [encoder.encodedData setLength:totalLength];
        
        // Copy the encoded data
        OSStatus result = CMBlockBufferCopyDataBytes(blockBuffer, 0, totalLength, encoder.encodedData.mutableBytes);
        if (result != noErr) {
            NSLog(@"❌ VP9 failed to copy encoded data: %d", (int)result);
        }
    }
    
    // Signal that encoding is complete
    dispatch_semaphore_signal(encoder.encodingSemaphore);
}

@implementation VP9Encoder

- (instancetype)initWithWidth:(int)width height:(int)height {
    self = [super init];
    if (self) {
        self.isInitialized = NO;
        self.compressionSession = NULL;
        self.encodedData = [NSMutableData data];
        self.encodingSemaphore = dispatch_semaphore_create(0);
        
        [self setupCompressionSessionWithWidth:width height:height];
    }
    return self;
}

- (void)setupCompressionSessionWithWidth:(int)width height:(int)height {
    OSStatus status;
    
    // Create compression session with VP9 codec
    status = VTCompressionSessionCreate(NULL,
                                       width, height,
                                       kCMVideoCodecType_VP9,
                                       NULL,
                                       NULL,
                                       NULL,
                                       compressionOutputCallback,
                                       (__bridge void *)self,
                                       &_compressionSession);
    
    if (status != noErr) {
        NSLog(@"❌ Failed to create VP9 compression session: %d", (int)status);
        // Try H.264 as fallback
        status = VTCompressionSessionCreate(NULL,
                                           width, height,
                                           kCMVideoCodecType_H264,
                                           NULL,
                                           NULL,
                                           NULL,
                                           compressionOutputCallback,
                                           (__bridge void *)self,
                                           &_compressionSession);
        
        if (status != noErr) {
            NSLog(@"❌ Failed to create H.264 fallback compression session: %d", (int)status);
            return;
        }
        NSLog(@"⚠️ VP9 not available, using H.264 fallback");
    } else {
        NSLog(@"✅ VP9 compression session created successfully");
    }
    
    // Configure for real-time encoding
    VTSessionSetProperty(_compressionSession, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
    VTSessionSetProperty(_compressionSession, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
    
    // Set quality and bitrate
    VTSessionSetProperty(_compressionSession, kVTCompressionPropertyKey_Quality, (__bridge CFNumberRef)@(0.8));
    
    int bitrate = 8000000; // 8 Mbps
    VTSessionSetProperty(_compressionSession, kVTCompressionPropertyKey_AverageBitRate, (__bridge CFNumberRef)@(bitrate));
    
    // Set frame rate
    int frameRate = 30;
    VTSessionSetProperty(_compressionSession, kVTCompressionPropertyKey_ExpectedFrameRate, (__bridge CFNumberRef)@(frameRate));
    
    self.isInitialized = YES;
}

- (NSData *)encodeFrame:(CVPixelBufferRef)pixelBuffer {
    if (!self.isInitialized || !self.compressionSession) {
        NSLog(@"❌ VP9 encoder not initialized");
        return nil;
    }
    
    // Reset semaphore state
    while (dispatch_semaphore_wait(self.encodingSemaphore, DISPATCH_TIME_NOW) == 0) {
        // Drain any pending signals
    }
    
    // Clear previous encoded data
    [self.encodedData setLength:0];
    
    // Encode the frame
    OSStatus status = VTCompressionSessionEncodeFrame(_compressionSession,
                                                     pixelBuffer,
                                                     kCMTimeInvalid,
                                                     kCMTimeInvalid,
                                                     NULL,
                                                     NULL,
                                                     NULL);
    
    if (status != noErr) {
        NSLog(@"❌ VP9 encoding failed: %d", (int)status);
        return nil;
    }
    
    // Wait for encoding to complete (with timeout)
    dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC); // 100ms timeout
    if (dispatch_semaphore_wait(self.encodingSemaphore, timeout) != 0) {
        NSLog(@"❌ VP9 encoding timeout");
        return nil;
    }
    
    // Return a copy of the encoded data
    return [self.encodedData copy];
}

- (void)cleanup {
    if (self.compressionSession) {
        VTCompressionSessionCompleteFrames(_compressionSession, kCMTimeInvalid);
        VTCompressionSessionInvalidate(_compressionSession);
        CFRelease(_compressionSession);
        _compressionSession = NULL;
    }
    self.isInitialized = NO;
}

- (void)dealloc {
    [self cleanup];
}

@end