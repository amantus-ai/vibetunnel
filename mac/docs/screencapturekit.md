<!--
Downloaded via https://llm.codes by @steipete on July 6, 2025 at 01:40 AM
Source URL: https://developer.apple.com/documentation/screencapturekit
Total pages processed: 163
URLs filtered: Yes
Content de-duplicated: Yes
Availability strings filtered: Yes
Code blocks only: No
-->

# https://developer.apple.com/documentation/screencapturekit

Framework

# ScreenCaptureKit

Filter and select screen content and stream it to your app.

## Overview

Use the ScreenCaptureKit framework to add support for high-performance frame capture of screen and audio content to your Mac app. The framework gives you fine-grained control to select and stream only the content that you want to capture. As a stream captures new video frames and audio samples, it passes them to your app as `CMSampleBuffer` objects that contain the media data and its related metadata. ScreenCaptureKit also provides a macOS-integrated picker for streaming selection and management, `SCContentSharingPicker`.

## Topics

### Essentials

ScreenCaptureKit updates

Learn about important changes to ScreenCaptureKit.

`Persistent Content Capture`

A Boolean value that indicates whether a Virtual Network Computing (VNC) app needs persistent access to screen capture.

Capturing screen content in macOS

Stream desktop content like displays, apps, and windows by adopting screen capture in your app.

### Shareable content

`class SCShareableContent`

An instance that represents a set of displays, apps, and windows that your app can capture.

`class SCShareableContentInfo`

An instance that provides information for the content in a given stream.

`enum SCShareableContentStyle`

The style of content presented in a stream.

`class SCDisplay`

An instance that represents a display device.

`class SCRunningApplication`

An instance that represents an app running on a device.

`class SCWindow`

An instance that represents an onscreen window.

### Content capture

`class SCStream`

An instance that represents a stream of shareable content.

`class SCStreamConfiguration`

An instance that provides the output configuration for a stream.

`class SCContentFilter`

An instance that filters the content a stream captures.

`protocol SCStreamDelegate`

A delegate protocol your app implements to respond to stream events.

`class SCScreenshotManager`

An instance for the capture of single frames from a stream.

`class SCScreenshotConfiguration`

`class SCScreenshotOutput`

### Output processing

`protocol SCStreamOutput`

A delegate protocol your app implements to receive capture stream output events.

`enum SCStreamOutputType`

Constants that represent output types for a stream frame.

`struct SCStreamFrameInfo`

An instance that defines metadata keys for a stream frame.

`enum SCFrameStatus`

Status values for a frame from a stream.

### System content-sharing picker

`class SCContentSharingPicker`

An instance of a picker presented by the operating system for managing frame-capture streams.

`struct SCContentSharingPickerConfiguration`

An instance for configuring the system content-sharing picker.

`struct SCContentSharingPickerMode`

Available modes for selecting streaming content from a picker presented by the operating system.

`protocol SCContentSharingPickerObserver`

An observer protocol your app implements to receive messages from the operating system’s content picker.

### Stream errors

`let SCStreamErrorDomain: String`

A string representation of the error domain.

`struct SCStreamError`

An instance representing a ScreenCaptureKit framework error.

---

# https://developer.apple.com/documentation/screencapturekit/

Framework

# ScreenCaptureKit

Filter and select screen content and stream it to your app.

## Overview

Use the ScreenCaptureKit framework to add support for high-performance frame capture of screen and audio content to your Mac app. The framework gives you fine-grained control to select and stream only the content that you want to capture. As a stream captures new video frames and audio samples, it passes them to your app as `CMSampleBuffer` objects that contain the media data and its related metadata. ScreenCaptureKit also provides a macOS-integrated picker for streaming selection and management, `SCContentSharingPicker`.

## Topics

### Essentials

ScreenCaptureKit updates

Learn about important changes to ScreenCaptureKit.

`Persistent Content Capture`

A Boolean value that indicates whether a Virtual Network Computing (VNC) app needs persistent access to screen capture.

Capturing screen content in macOS

Stream desktop content like displays, apps, and windows by adopting screen capture in your app.

### Shareable content

`class SCShareableContent`

An instance that represents a set of displays, apps, and windows that your app can capture.

`class SCShareableContentInfo`

An instance that provides information for the content in a given stream.

`enum SCShareableContentStyle`

The style of content presented in a stream.

`class SCDisplay`

An instance that represents a display device.

`class SCRunningApplication`

An instance that represents an app running on a device.

`class SCWindow`

An instance that represents an onscreen window.

### Content capture

`class SCStream`

An instance that represents a stream of shareable content.

`class SCStreamConfiguration`

An instance that provides the output configuration for a stream.

`class SCContentFilter`

An instance that filters the content a stream captures.

`protocol SCStreamDelegate`

A delegate protocol your app implements to respond to stream events.

`class SCScreenshotManager`

An instance for the capture of single frames from a stream.

`class SCScreenshotConfiguration`

`class SCScreenshotOutput`

### Output processing

`protocol SCStreamOutput`

A delegate protocol your app implements to receive capture stream output events.

`enum SCStreamOutputType`

Constants that represent output types for a stream frame.

`struct SCStreamFrameInfo`

An instance that defines metadata keys for a stream frame.

`enum SCFrameStatus`

Status values for a frame from a stream.

### System content-sharing picker

`class SCContentSharingPicker`

An instance of a picker presented by the operating system for managing frame-capture streams.

`struct SCContentSharingPickerConfiguration`

An instance for configuring the system content-sharing picker.

`struct SCContentSharingPickerMode`

Available modes for selecting streaming content from a picker presented by the operating system.

`protocol SCContentSharingPickerObserver`

An observer protocol your app implements to receive messages from the operating system’s content picker.

### Stream errors

`let SCStreamErrorDomain: String`

A string representation of the error domain.

`struct SCStreamError`

An instance representing a ScreenCaptureKit framework error.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker

- ScreenCaptureKit
- SCContentSharingPicker

Class

# SCContentSharingPicker

An instance of a picker presented by the operating system for managing frame-capture streams.

class SCContentSharingPicker

## Overview

## Topics

### Shared system picker

`class var shared: SCContentSharingPicker`

The system-provided picker UI instance for capturing display and audio content from someone’s Mac.

### Picker availability

`var isActive: Bool`

A Boolean value that indicates if the picker is active.

### Stream configuration

`func setConfiguration(SCContentSharingPickerConfiguration?, for: SCStream)`

Sets the configuration for the content capture picker for a capture stream, providing allowed selection modes and content excluded from selection.

`var configuration: SCContentSharingPickerConfiguration?`

Sets the configuration for the content capture picker for all streams, providing allowed selection modes and content excluded from selection.

`var defaultConfiguration: SCContentSharingPickerConfiguration`

The default configuration to use for the content capture picker.

`var maximumStreamCount: Int?`

The maximum number of streams the content capture picker allows.

### Manage observers

`func add(any SCContentSharingPickerObserver)`

Adds an observer instance to notify of changes in the content-sharing picker.

`func remove(any SCContentSharingPickerObserver)`

Removes an observer instance from the content-sharing picker.

### Picker display

`func present()`

Displays the picker with no active selection for capture.

`func present(for: SCStream)`

Displays the picker with an already running capture stream.

`func present(using: SCShareableContentStyle)`

Displays the picker for a single type of capture selection.

`func present(for: SCStream, using: SCShareableContentStyle)`

Displays the picker with an existing capture stream, allowing for a single type of capture selection.

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### System content-sharing picker

`struct SCContentSharingPickerConfiguration`

An instance for configuring the system content-sharing picker.

`struct SCContentSharingPickerMode`

Available modes for selecting streaming content from a picker presented by the operating system.

`protocol SCContentSharingPickerObserver`

An observer protocol your app implements to receive messages from the operating system’s content picker.

---

# https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos

- ScreenCaptureKit
- Capturing screen content in macOS

Sample Code

# Capturing screen content in macOS

Stream desktop content like displays, apps, and windows by adopting screen capture in your app.

Download

Xcode 16.0+

## Overview

This sample shows how to add high-performance screen capture to your Mac app by using ScreenCaptureKit. The sample explores how to create content filters to capture the displays, apps, and windows you choose. It then shows how to configure your stream output, retrieve video frames and audio samples, and update a running stream.

### Configure the sample code project

To run this sample app, you’ll need the following:

- A Mac with macOS 15 or later

- Xcode 16 or later

The first time you run this sample, the system prompts you to grant the app Screen Recording permission. After you grant permission, you need to restart the app to enable capture.

### Create a content filter

Displays, running apps, and windows are the shareable content on a device. The sample uses the `SCShareableContent` class to retrieve the items in the form of `SCDisplay`, `SCRunningApplication`, and `SCWindow` objects respectively.

// Retrieve the available screen content to capture.
let availableContent = try await SCShareableContent.excludingDesktopWindows(false,
onScreenWindowsOnly: true)

Before the sample begins capture, it creates an `SCContentFilter` object to specify the content to capture. The sample provides two options that allow for capturing either a single window or an entire display. When the capture type is set to capture a window, the app creates a content filter that only includes that window.

// Create a content filter that includes a single window.
filter = SCContentFilter(desktopIndependentWindow: window)

When a user specifies to capture the entire display, the sample creates a filter to capture only content from the main display. To illustrate filtering a running app, the sample contains a toggle to specify whether to exclude the sample app from the stream.

var excludedApps = SCRunningApplication
// If a user chooses to exclude the app from the stream,
// exclude it by matching its bundle identifier.
if isAppExcluded {
excludedApps = availableApps.filter { app in
Bundle.main.bundleIdentifier == app.bundleIdentifier
}
}
// Create a content filter with excluded apps.
filter = SCContentFilter(display: display,
excludingApplications: excludedApps,
exceptingWindows: [])

### Create a stream configuration

An `SCStreamConfiguration` object provides properties to configure the stream’s output size, pixel format, audio capture settings, and more. The app’s configuration throttles frame updates to 60 fps, and configures the number of frames to keep in the queue at 5. Specifying more frames uses more memory, but may allow for processing frame data without stalling the display stream. The default value is 3 and shouldn’t exceed 8 frames.

var streamConfig = SCStreamConfiguration()

if let dynamicRangePreset = selectedDynamicRangePreset?.scDynamicRangePreset {
streamConfig = SCStreamConfiguration(preset: dynamicRangePreset)
}

// Configure audio capture.
streamConfig.capturesAudio = isAudioCaptureEnabled
streamConfig.excludesCurrentProcessAudio = isAppAudioExcluded
streamConfig.captureMicrophone = isMicCaptureEnabled

// Configure the display content width and height.
if captureType == .display, let display = selectedDisplay {
streamConfig.width = display.width * scaleFactor
streamConfig.height = display.height * scaleFactor
}

// Configure the window content width and height.
if captureType == .window, let window = selectedWindow {
streamConfig.width = Int(window.frame.width) * 2
streamConfig.height = Int(window.frame.height) * 2
}

// Set the capture interval at 60 fps.
streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: 60)

// Increase the depth of the frame queue to ensure high fps at the expense of increasing
// the memory footprint of WindowServer.
streamConfig.queueDepth = 5

### Start the capture session

The sample uses the content filter and stream configuration to initialize a new instance of `SCStream`. To retrieve audio and video sample data, the app adds stream outputs that capture media of the specified type. When the stream captures new sample buffers, it delivers them to its stream output object on the indicated dispatch queues.

stream = SCStream(filter: filter, configuration: configuration, delegate: streamOutput)

// Add a stream output to capture screen content.
try stream?.addStreamOutput(streamOutput, type: .screen, sampleHandlerQueue: videoSampleBufferQueue)
try stream?.addStreamOutput(streamOutput, type: .audio, sampleHandlerQueue: audioSampleBufferQueue)
try stream?.addStreamOutput(streamOutput, type: .microphone, sampleHandlerQueue: micSampleBufferQueue)
stream?.startCapture()

After the stream starts, further changes to its configuration and content filter don’t require restarting it. Instead, after you update the capture configuration in the user interface, the sample creates new stream configuration and content filter objects and applies them to the running stream to update its state.

try await stream?.updateConfiguration(configuration)
try await stream?.updateContentFilter(filter)

### Process the output

When a stream captures a new audio or video sample buffer, it calls the stream output’s `stream(_:didOutputSampleBuffer:of:)` method, passing it the captured data and an indicator of its type. The stream output evaluates and processes the sample buffer as shown below.

func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {

// Return early if the sample buffer is invalid.
guard sampleBuffer.isValid else { return }

// Determine which type of data the sample buffer contains.
switch outputType {
case .screen:
// Process the screen content.
case .audio:
// Process the audio content.
}
}

### Process a video sample buffer

If the sample buffer contains video data, it retrieves the sample buffer attachments that describe the output video frame.

// Retrieve the array of metadata attachments from the sample buffer.
guard let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer,
createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
let attachments = attachmentsArray.first else { return nil }

An `SCStreamFrameInfo` structure defines dictionary keys that the sample uses to retrieve metadata attached to a sample buffer. Metadata includes information about the frame’s display time, scale factor, status, and more. To determine whether a frame is available for processing, the sample inspects the status for `SCFrameStatus.complete`.

// Validate the status of the frame. If it isn't `.complete`, return nil.
guard let statusRawValue = attachments[SCStreamFrameInfo.status] as? Int,
let status = SCFrameStatus(rawValue: statusRawValue),
status == .complete else { return nil }

The sample buffer wraps a `CVPixelBuffer` that’s backed by an `IOSurface`. The sample casts the surface reference to an `IOSurface` that it later sets as the layer content of an `NSView`.

// Get the pixel buffer that contains the image data.
guard let pixelBuffer = sampleBuffer.imageBuffer else { return nil }

// Get the backing IOSurface.
guard let surfaceRef = CVPixelBufferGetIOSurface(pixelBuffer)?.takeUnretainedValue() else { return nil }
let surface = unsafeBitCast(surfaceRef, to: IOSurface.self)

// swiftlint:disable force_cast
// Retrieve the content rectangle, scale, and scale factor.
guard let contentRectDict = attachments[.contentRect],
let contentRect = CGRect(dictionaryRepresentation: contentRectDict as! CFDictionary),
let contentScale = attachments[.contentScale] as? CGFloat,
let scaleFactor = attachments[.scaleFactor] as? CGFloat else { return nil }

// Create a new frame with the relevant data.
let frame = CapturedFrame(surface: surface,
contentRect: contentRect,
contentScale: contentScale,
scaleFactor: scaleFactor)

### Process an audio sample buffer

If the sample buffer contains audio, it retrieves the data as an `AudioBufferList` as shown below.

// Create an AVAudioPCMBuffer from an audio sample buffer.
try? buffer.withAudioBufferList { audioBufferList, blockBuffer in
guard let description = buffer.formatDescription?.audioStreamBasicDescription,
let format = AVAudioFormat(standardFormatWithSampleRate: description.mSampleRate, channels: description.mChannelsPerFrame),
let samples = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: audioBufferList.unsafePointer)
else { return }
pcmBufferHandler?(samples)
}
}

The app retrieves the audio stream basic description that it uses to create an `AVAudioFormat`. It then uses the format and the audio buffer list to create a new instance of `AVAudioPCMBuffer`. If you enable audio capture in the user interface, the sample uses the buffer to calculate average levels for the captured audio to display in a simple level meter.

## See Also

### Essentials

ScreenCaptureKit updates

Learn about important changes to ScreenCaptureKit.

`Persistent Content Capture`

A Boolean value that indicates whether a Virtual Network Computing (VNC) app needs persistent access to screen capture.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent

- ScreenCaptureKit
- SCShareableContent

Class

# SCShareableContent

An instance that represents a set of displays, apps, and windows that your app can capture.

class SCShareableContent

## Overview

Use the `displays`, `windows`, and `applications` properties to create a `SCContentFilter` object that specifies what display content to capture. You apply the filter to an instance of `SCStream` to limit its output to only the content matching your filter.

## Topics

### Retrieving shareable content

Retrieves the displays, apps, and windows that your app can capture.

Retrieves the displays, apps, and windows that match your criteria.

Retrieves the displays, apps, and windows that are in front of the specified window.

Retrieves the displays, apps, and windows that are behind the specified window.

Retrieves any available sharable content information that matches the provided filter.

### Inspecting shareable content

[`var windows: [SCWindow]`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/windows)

The windows available for capture.

[`var displays: [SCDisplay]`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/displays)

The displays available for capture.

[`var applications: [SCRunningApplication]`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/applications)

The apps available for capture.

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Shareable content

`class SCShareableContentInfo`

An instance that provides information for the content in a given stream.

`enum SCShareableContentStyle`

The style of content presented in a stream.

`class SCDisplay`

An instance that represents a display device.

`class SCRunningApplication`

An instance that represents an app running on a device.

`class SCWindow`

An instance that represents an onscreen window.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentinfo

- ScreenCaptureKit
- SCShareableContentInfo

Class

# SCShareableContentInfo

An instance that provides information for the content in a given stream.

class SCShareableContentInfo

## Topics

### Shared content properties

`var contentRect: CGRect`

The size and location of content for the stream.

`var pointPixelScale: Float`

The scaling from points to output pixel resolution for the stream.

`var style: SCShareableContentStyle`

The current presentation style of the stream.

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Shareable content

`class SCShareableContent`

An instance that represents a set of displays, apps, and windows that your app can capture.

`enum SCShareableContentStyle`

The style of content presented in a stream.

`class SCDisplay`

An instance that represents a display device.

`class SCRunningApplication`

An instance that represents an app running on a device.

`class SCWindow`

An instance that represents an onscreen window.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle

- ScreenCaptureKit
- SCShareableContentStyle

Enumeration

# SCShareableContentStyle

The style of content presented in a stream.

enum SCShareableContentStyle

## Topics

### Content styles

`case application`

The stream is currently presenting one or more applications.

`case display`

The stream is currently presenting a complete display.

`case none`

The stream isn’t currently presenting any content.

`case window`

The stream is currently presenting one or more windows.

### Initializers

`init?(rawValue: Int)`

## Relationships

### Conforms To

- `BitwiseCopyable`
- `Equatable`
- `Hashable`
- `RawRepresentable`
- `Sendable`
- `SendableMetatype`

## See Also

### Shareable content

`class SCShareableContent`

An instance that represents a set of displays, apps, and windows that your app can capture.

`class SCShareableContentInfo`

An instance that provides information for the content in a given stream.

`class SCDisplay`

An instance that represents a display device.

`class SCRunningApplication`

An instance that represents an app running on a device.

`class SCWindow`

An instance that represents an onscreen window.

---

# https://developer.apple.com/documentation/screencapturekit/scdisplay

- ScreenCaptureKit
- SCDisplay

Class

# SCDisplay

An instance that represents a display device.

class SCDisplay

## Overview

A display object represents a physical display connected to a Mac. Query the display to retrieve its unique identifier and onscreen coordinates.

Retrieve the available displays from an instance of `SCShareableContent`. Select a display to capture and use it to create an instance of `SCContentFilter`. Apply the filter to an instance of `SCStream` to limit its output to content matching your criteria.

## Topics

### Identifying displays

`var displayID: CGDirectDisplayID`

The Core Graphics display identifier.

### Accessing dimensions

`var frame: CGRect`

The frame of the display.

`var width: Int`

The width of the display in points.

`var height: Int`

The height of the display in points.

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Shareable content

`class SCShareableContent`

An instance that represents a set of displays, apps, and windows that your app can capture.

`class SCShareableContentInfo`

An instance that provides information for the content in a given stream.

`enum SCShareableContentStyle`

The style of content presented in a stream.

`class SCRunningApplication`

An instance that represents an app running on a device.

`class SCWindow`

An instance that represents an onscreen window.

---

# https://developer.apple.com/documentation/screencapturekit/scrunningapplication

- ScreenCaptureKit
- SCRunningApplication

Class

# SCRunningApplication

An instance that represents an app running on a device.

class SCRunningApplication

## Overview

Retrieve the available apps from an instance of `SCShareableContent`. Select one or more apps to capture and use them to create an instance of `SCContentFilter`. Apply the filter to an instance of `SCStream` to limit its output to content matching your criteria.

## Topics

### Inspecting an app

`var processID: pid_t`

The system process identifier of the app.

`var bundleIdentifier: String`

The unique bundle identifier of the app.

`var applicationName: String`

The display name of the app.

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Shareable content

`class SCShareableContent`

An instance that represents a set of displays, apps, and windows that your app can capture.

`class SCShareableContentInfo`

An instance that provides information for the content in a given stream.

`enum SCShareableContentStyle`

The style of content presented in a stream.

`class SCDisplay`

An instance that represents a display device.

`class SCWindow`

An instance that represents an onscreen window.

---

# https://developer.apple.com/documentation/screencapturekit/scwindow

- ScreenCaptureKit
- SCWindow

Class

# SCWindow

An instance that represents an onscreen window.

class SCWindow

## Overview

Retrieve the available windows from an instance of `SCShareableContent`. Select one or more windows to capture and use them to create an instance of `SCContentFilter`. Apply the filter to an instance of `SCStream` to limit its output to content matching your criteria.

## Topics

### Identifying windows

`var windowID: CGWindowID`

The Core Graphics window identifier.

`var title: String?`

The string that displays in a window’s title bar.

`var owningApplication: SCRunningApplication?`

The app that owns the window.

`var windowLayer: Int`

The layer of the window relative to other windows.

### Accessing dimensions

`var frame: CGRect`

A rectangle the represents the frame of the window within a display.

### Determining visibility

`var isOnScreen: Bool`

A Boolean value that indicates whether the window is on screen.

`var isActive: Bool`

A Boolean value that indicates if the window is currently streaming.

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Shareable content

`class SCShareableContent`

An instance that represents a set of displays, apps, and windows that your app can capture.

`class SCShareableContentInfo`

An instance that provides information for the content in a given stream.

`enum SCShareableContentStyle`

The style of content presented in a stream.

`class SCDisplay`

An instance that represents a display device.

`class SCRunningApplication`

An instance that represents an app running on a device.

---

# https://developer.apple.com/documentation/screencapturekit/scstream

- ScreenCaptureKit
- SCStream

Class

# SCStream

An instance that represents a stream of shareable content.

class SCStream

## Overview

Use a stream to capture video of screen content like apps and windows. Create a content stream by passing it an instance of `SCContentFilter` and an `SCStreamConfiguration` object. The stream uses the filter to determine which screen content to capture, and uses the configuration data to configure the output.

## Topics

### Creating a stream

`init(filter: SCContentFilter, configuration: SCStreamConfiguration, delegate: (any SCStreamDelegate)?)`

Creates a stream with a content filter and configuration.

### Updating stream configuration

Updates the stream with a new configuration.

Updates the stream by applying a new content filter.

### Adding and removing stream output

`func addStreamOutput(any SCStreamOutput, type: SCStreamOutputType, sampleHandlerQueue: dispatch_queue_t?) throws`

Adds a destination that receives the stream output.

`func removeStreamOutput(any SCStreamOutput, type: SCStreamOutputType) throws`

Removes a destination from receiving stream output.

### Adding and removing recording output

`func addRecordingOutput(SCRecordingOutput) throws`

`func removeRecordingOutput(SCRecordingOutput) throws`

`class SCRecordingOutput`

### Starting and stopping a stream

Starts the stream with a call)

Stops the stream.

### Stream synchronization

`var synchronizationClock: CMClock?`

A clock to use for output synchronization.

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Content capture

`class SCStreamConfiguration`

An instance that provides the output configuration for a stream.

`class SCContentFilter`

An instance that filters the content a stream captures.

`protocol SCStreamDelegate`

A delegate protocol your app implements to respond to stream events.

`class SCScreenshotManager`

An instance for the capture of single frames from a stream.

`class SCScreenshotConfiguration`

`class SCScreenshotOutput`

---

# https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration

- ScreenCaptureKit
- SCStreamConfiguration

Class

# SCStreamConfiguration

An instance that provides the output configuration for a stream.

class SCStreamConfiguration

## Overview

Creating an instance of this class provides a default configuration for a stream. Only configure its properties if you need to customize the output.

## Topics

### Specifying dimensions

`var width: Int`

The width of the output.

`var height: Int`

The height of the output.

`var scalesToFit: Bool`

A Boolean value that indicates whether to scale the output to fit the configured width and height.

`var sourceRect: CGRect`

A rectangle that specifies the source area to capture.

`var destinationRect: CGRect`

A rectangle that specifies a destination into which to write the output.

`var preservesAspectRatio: Bool`

A Boolean value that determines if the stream preserves aspect ratio.

### Configuring colors

`var pixelFormat: OSType`

A pixel format for sample buffers that a stream outputs.

`var colorMatrix: CFString`

A color matrix to apply to the output surface.

`var colorSpaceName: CFString`

A color space to use for the output buffer.

`var backgroundColor: CGColor`

A background color for the output.

### Configuring captured elements

`var showsCursor: Bool`

A Boolean value that determines whether the cursor is visible in the stream.

`var shouldBeOpaque: Bool`

A Boolean value that indicates if semitransparent content presents as opaque.

`var capturesShadowsOnly: Bool`

A Boolean value that indicates if the stream only captures shadows.

`var ignoreShadowsDisplay: Bool`

A Boolean value that indicates if the stream ignores the capturing of window shadows when streaming in display style.

`var ignoreShadowsSingleWindow: Bool`

A Boolean value that indicates if the stream ignores the capturing of window shadows when streaming in window style.

`var ignoreGlobalClipDisplay: Bool`

A Boolean value that indicates if the stream ignores content clipped past the edge of a display, when streaming in display style.

`var ignoreGlobalClipSingleWindow: Bool`

A Boolean value that indicates if the stream ignores content clipped past the edge of a display, when streaming in window style.

### Configuring captured frames

`var queueDepth: Int`

The maximum number of frames for the queue to store.

`var minimumFrameInterval: CMTime`

The desired minimum time between frame updates, in seconds.

`var captureResolution: SCCaptureResolutionType`

The resolution at which to capture source content.

`enum SCCaptureResolutionType`

Available resolutions for content capture.

### Configuring audio

`var capturesAudio: Bool`

A Boolean value that indicates whether to capture audio.

`var sampleRate: Int`

The sample rate for audio capture.

`var channelCount: Int`

The number of audio channels to capture.

`var excludesCurrentProcessAudio: Bool`

A Boolean value that indicates whether to exclude audio from your app during capture.

### Identifying a stream

`var streamName: String?`

A name that you provide for identifying the stream.

### Notifying presenters

`var presenterOverlayPrivacyAlertSetting: SCPresenterOverlayAlertSetting`

A value indicating if alerts appear to presenters while using Presenter Overlay.

`enum SCPresenterOverlayAlertSetting`

Configures how to present streaming notifications to a streamer of Presenter Overlay.

### Enumerations

`enum SCCaptureDynamicRange`

`enum Preset`

### Initializers

`convenience init(preset: SCStreamConfiguration.Preset)`

### Instance Properties

`var captureDynamicRange: SCCaptureDynamicRange`

`var captureMicrophone: Bool`

`var includeChildWindows: Bool`

`var microphoneCaptureDeviceID: String?`

`var showMouseClicks: Bool`

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Content capture

`class SCStream`

An instance that represents a stream of shareable content.

`class SCContentFilter`

An instance that filters the content a stream captures.

`protocol SCStreamDelegate`

A delegate protocol your app implements to respond to stream events.

`class SCScreenshotManager`

An instance for the capture of single frames from a stream.

`class SCScreenshotConfiguration`

`class SCScreenshotOutput`

---

# https://developer.apple.com/documentation/screencapturekit/sccontentfilter

- ScreenCaptureKit
- SCContentFilter

Class

# SCContentFilter

An instance that filters the content a stream captures.

class SCContentFilter

## Overview

Use a content filter to limit an `SCStream` object’s output to only that matching your filter criteria. Retrieve the displays, apps, and windows that your app can capture from an instance of `SCShareableContent`.

## Topics

### Creating a filter

`init(desktopIndependentWindow: SCWindow)`

Creates a filter that captures only the specified window.

[`init(display: SCDisplay, including: [SCWindow])`](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(display:including:))

Creates a filter that captures only specific windows from a display.

[`init(display: SCDisplay, excludingWindows: [SCWindow])`](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(display:excludingwindows:))

Creates a filter that captures the contents of a display, excluding the specified windows.

[`init(display: SCDisplay, including: [SCRunningApplication], exceptingWindows: [SCWindow])`](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(display:including:exceptingwindows:))

Creates a filter that captures a display, including only windows of the specified apps.

[`init(display: SCDisplay, excludingApplications: [SCRunningApplication], exceptingWindows: [SCWindow])`](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(display:excludingapplications:exceptingwindows:))

Creates a filter that captures a display, excluding windows of the specified apps.

### Filter properties

`var contentRect: CGRect`

The size and location of the content to filter, in screen points.

`var pointPixelScale: Float`

The scaling factor used to translate screen points into pixels.

`var streamType: SCStreamType`

The type of the streaming content.

Deprecated

`enum SCStreamType`

The display type of the presented stream.

`var style: SCShareableContentStyle`

The display style of the sharable content.

### Instance Properties

`var includeMenuBar: Bool`

[`var includedApplications: [SCRunningApplication]`](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/includedapplications)

[`var includedDisplays: [SCDisplay]`](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/includeddisplays)

[`var includedWindows: [SCWindow]`](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/includedwindows)

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Content capture

`class SCStream`

An instance that represents a stream of shareable content.

`class SCStreamConfiguration`

An instance that provides the output configuration for a stream.

`protocol SCStreamDelegate`

A delegate protocol your app implements to respond to stream events.

`class SCScreenshotManager`

An instance for the capture of single frames from a stream.

`class SCScreenshotConfiguration`

`class SCScreenshotOutput`

---

# https://developer.apple.com/documentation/screencapturekit/scstreamdelegate

- ScreenCaptureKit
- SCStreamDelegate

Protocol

# SCStreamDelegate

A delegate protocol your app implements to respond to stream events.

protocol SCStreamDelegate : NSObjectProtocol

## Topics

### Responding to Presenter Overlay

`func outputVideoEffectDidStart(for: SCStream)`

Tells the delegate that Presenter Overlay started.

`func outputVideoEffectDidStop(for: SCStream)`

Tells the delegate that Presenter Overlay stopped.

### Responding to stream stoppage

`func stream(SCStream, didStopWithError: any Error)`

Tells the delegate that the stream stopped with an error.

### Instance Methods

`func streamDidBecomeActive(SCStream)`

`func streamDidBecomeInactive(SCStream)`

## Relationships

### Inherits From

- `NSObjectProtocol`

## See Also

### Content capture

`class SCStream`

An instance that represents a stream of shareable content.

`class SCStreamConfiguration`

An instance that provides the output configuration for a stream.

`class SCContentFilter`

An instance that filters the content a stream captures.

`class SCScreenshotManager`

An instance for the capture of single frames from a stream.

`class SCScreenshotConfiguration`

`class SCScreenshotOutput`

---

# https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager

- ScreenCaptureKit
- SCScreenshotManager

Class

# SCScreenshotManager

An instance for the capture of single frames from a stream.

class SCScreenshotManager

## Topics

### Individual frame capture

Captures a single frame from a stream as an image, using a filter.

Captures a single frame directly from a stream’s buffer, using a filter.

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Content capture

`class SCStream`

An instance that represents a stream of shareable content.

`class SCStreamConfiguration`

An instance that provides the output configuration for a stream.

`class SCContentFilter`

An instance that filters the content a stream captures.

`protocol SCStreamDelegate`

A delegate protocol your app implements to respond to stream events.

`class SCScreenshotConfiguration`

`class SCScreenshotOutput`

---

# https://developer.apple.com/documentation/screencapturekit/scscreenshotconfiguration

- ScreenCaptureKit
- SCScreenshotConfiguration

Class

# SCScreenshotConfiguration

Mac CatalystmacOS

class SCScreenshotConfiguration

## Topics

### Instance Properties

`var contentType: UTTypeReference`

`var destinationRect: CGRect`

`var displayIntent: SCScreenshotConfiguration.DisplayIntent`

`var dynamicRange: SCScreenshotConfiguration.DynamicRange`

`var fileURL: URL?`

`var height: Int`

`var ignoreClipping: Bool`

`var ignoreShadows: Bool`

`var includeChildWindows: Bool`

`var showsCursor: Bool`

`var sourceRect: CGRect`

`var width: Int`

### Type Properties

[`class var supportedContentTypes: [UTType]`](https://developer.apple.com/documentation/screencapturekit/scscreenshotconfiguration/supportedcontenttypes)

### Enumerations

`enum DisplayIntent`

`enum DynamicRange`

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Content capture

`class SCStream`

An instance that represents a stream of shareable content.

`class SCStreamConfiguration`

An instance that provides the output configuration for a stream.

`class SCContentFilter`

An instance that filters the content a stream captures.

`protocol SCStreamDelegate`

A delegate protocol your app implements to respond to stream events.

`class SCScreenshotManager`

An instance for the capture of single frames from a stream.

`class SCScreenshotOutput`

---

# https://developer.apple.com/documentation/screencapturekit/scscreenshotoutput

- ScreenCaptureKit
- SCScreenshotOutput

Class

# SCScreenshotOutput

Mac CatalystmacOS

class SCScreenshotOutput

## Topics

### Instance Properties

`var fileURL: NSURL?`

`var hdrImage: CGImage?`

`var sdrImage: CGImage?`

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Content capture

`class SCStream`

An instance that represents a stream of shareable content.

`class SCStreamConfiguration`

An instance that provides the output configuration for a stream.

`class SCContentFilter`

An instance that filters the content a stream captures.

`protocol SCStreamDelegate`

A delegate protocol your app implements to respond to stream events.

`class SCScreenshotManager`

An instance for the capture of single frames from a stream.

`class SCScreenshotConfiguration`

---

# https://developer.apple.com/documentation/screencapturekit/scstreamoutput

- ScreenCaptureKit
- SCStreamOutput

Protocol

# SCStreamOutput

A delegate protocol your app implements to receive capture stream output events.

protocol SCStreamOutput : NSObjectProtocol

## Overview

The `SCStreamOutput` protocol provides a way to retrieve output from an `SCStream`.

After you call `startCapture(completionHandler:)`, the system provides frame data through the `stream(_:didOutputSampleBuffer:of:)` method. You can inspect the `CMSampleBuffer` to retrieve image data, and inspect the sample buffer for metadata about the frame.

## Topics

### Receiving stream output

`func stream(SCStream, didOutputSampleBuffer: CMSampleBuffer, of: SCStreamOutputType)`

Tells the delegate that a capture stream produced a frame.

## Relationships

### Inherits From

- `NSObjectProtocol`

## See Also

### Output processing

`enum SCStreamOutputType`

Constants that represent output types for a stream frame.

`struct SCStreamFrameInfo`

An instance that defines metadata keys for a stream frame.

`enum SCFrameStatus`

Status values for a frame from a stream.

---

# https://developer.apple.com/documentation/screencapturekit/scstreamoutputtype

- ScreenCaptureKit
- SCStreamOutputType

Enumeration

# SCStreamOutputType

Constants that represent output types for a stream frame.

enum SCStreamOutputType

## Topics

### Output types

`case screen`

An output type that represents a screen capture sample buffer.

`case audio`

An output type that represents an audio capture sample buffer.

### Enumeration Cases

`case microphone`

### Initializers

`init?(rawValue: Int)`

## Relationships

### Conforms To

- `BitwiseCopyable`
- `Equatable`
- `Hashable`
- `RawRepresentable`
- `Sendable`
- `SendableMetatype`

## See Also

### Output processing

`protocol SCStreamOutput`

A delegate protocol your app implements to receive capture stream output events.

`struct SCStreamFrameInfo`

An instance that defines metadata keys for a stream frame.

`enum SCFrameStatus`

Status values for a frame from a stream.

---

# https://developer.apple.com/documentation/screencapturekit/scstreamframeinfo

- ScreenCaptureKit
- SCStreamFrameInfo

Structure

# SCStreamFrameInfo

An instance that defines metadata keys for a stream frame.

struct SCStreamFrameInfo

## Overview

Use `SCStreamFrameInfo` keys to retrieve values from the dictionary of metadata attached to the sample buffers that a stream produces. For example, you can retrieve the display time, content scale, and scaling factor, as shown below:

// A dictionary of attachments for a streamed sample buffer.
let attachments: [SCStreamFrameInfo: Any] = // Retrieve attachments from a sample buffer.

let displayTime = attachments[.displayTime] as? UInt64 ?? 0
let contentScale = attachments[.contentScale] as? Double ?? 0.0
let scaleFactor = attachments[.scaleFactor] as? Double ?? 0.0

## Topics

### Frame information constants

`static let status: SCStreamFrameInfo`

A key to retrieve the status of a video frame.

`static let displayTime: SCStreamFrameInfo`

A key to retrieve the display time of a video frame.

`static let scaleFactor: SCStreamFrameInfo`

A key to retrieve the scale factor of a video frame.

`static let contentScale: SCStreamFrameInfo`

A key to retrieve the content scale of a video frame.

`static let contentRect: SCStreamFrameInfo`

A key to retrieve the content rectangle of a video frame.

`static let boundingRect: SCStreamFrameInfo`

A key to retrieve the bounding rectangle for a video frame.

`static let screenRect: SCStreamFrameInfo`

A key to retrieve the onscreen location of captured content.

`static let dirtyRects: SCStreamFrameInfo`

A key to retrieve the areas of a video frame that contain changes.

`static let presenterOverlayContentRect: SCStreamFrameInfo`

### Initializers

`init(rawValue: String)`

Creates a new instance with a raw value.

## Relationships

### Conforms To

- `Equatable`
- `Hashable`
- `RawRepresentable`
- `Sendable`
- `SendableMetatype`

## See Also

### Output processing

`protocol SCStreamOutput`

A delegate protocol your app implements to receive capture stream output events.

`enum SCStreamOutputType`

Constants that represent output types for a stream frame.

`enum SCFrameStatus`

Status values for a frame from a stream.

---

# https://developer.apple.com/documentation/screencapturekit/scframestatus

- ScreenCaptureKit
- SCFrameStatus

Enumeration

# SCFrameStatus

Status values for a frame from a stream.

enum SCFrameStatus

## Overview

You create a frame status by initializing it with the value you retrieve for the `status` from the sample buffer’s attachments dictionary.

if let statusRawValue = attachments[SCStreamFrameInfo.status] as? Int {
// Create status value.
let status = SCFrameStatus(rawValue: statusRawValue)
...
}

## Topics

### Status values

`case complete`

A status that indicates the system successfully generated a new frame.

`case idle`

A status that indicates the system didn’t generate a new frame because the display didn’t change.

`case blank`

A status that indicates the system didn’t generate a new frame because the display is blank.

`case started`

A status that indicates the frame is the first one sent after the stream starts.

`case suspended`

A status that indicates the system didn’t generate a new frame because you suspended updates.

`case stopped`

A status that indicates the frame is in a stopped state.

### Initializers

`init?(rawValue: Int)`

## Relationships

### Conforms To

- `BitwiseCopyable`
- `Equatable`
- `Hashable`
- `RawRepresentable`
- `Sendable`
- `SendableMetatype`

## See Also

### Output processing

`protocol SCStreamOutput`

A delegate protocol your app implements to receive capture stream output events.

`enum SCStreamOutputType`

Constants that represent output types for a stream frame.

`struct SCStreamFrameInfo`

An instance that defines metadata keys for a stream frame.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpickerconfiguration-swift.struct

- ScreenCaptureKit
- SCContentSharingPickerConfiguration

Structure

# SCContentSharingPickerConfiguration

An instance for configuring the system content-sharing picker.

struct SCContentSharingPickerConfiguration

## Topics

### Initializers

`init()`

Initializes a picker configuration with default values.

### Control streaming selections

`var allowedPickerModes: SCContentSharingPickerMode`

The content-selection modes supported by the picker.

`var allowsChangingSelectedContent: Bool`

A Boolean value that indicates if the present stream can change to a different source.

A list of bundle IDs to exclude from the sharing picker.

A list of window IDs to exclude from the sharing picker.

## See Also

### System content-sharing picker

`class SCContentSharingPicker`

An instance of a picker presented by the operating system for managing frame-capture streams.

`struct SCContentSharingPickerMode`

Available modes for selecting streaming content from a picker presented by the operating system.

`protocol SCContentSharingPickerObserver`

An observer protocol your app implements to receive messages from the operating system’s content picker.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpickermode

- ScreenCaptureKit
- SCContentSharingPickerMode

Structure

# SCContentSharingPickerMode

Available modes for selecting streaming content from a picker presented by the operating system.

struct SCContentSharingPickerMode

## Topics

### Initializers

`init(rawValue: UInt)`

Initializes a sharing-picker mode.

### Picker selection modes

`static var multipleApplications: SCContentSharingPickerMode`

The mode allowing the selection of multiple applications through the presented picker.

`static var multipleWindows: SCContentSharingPickerMode`

The mode allowing the selection of multiple windows through the presented picker.

`static var singleApplication: SCContentSharingPickerMode`

The mode allowing the selection of a single application through the presented picker.

`static var singleDisplay: SCContentSharingPickerMode`

The mode allowing the selection of a single display through the presented picker.

`static var singleWindow: SCContentSharingPickerMode`

The mode allowing the selection of a single window through the presented picker.

## Relationships

### Conforms To

- `BitwiseCopyable`
- `Equatable`
- `ExpressibleByArrayLiteral`
- `OptionSet`
- `RawRepresentable`
- `Sendable`
- `SendableMetatype`
- `SetAlgebra`

## See Also

### System content-sharing picker

`class SCContentSharingPicker`

An instance of a picker presented by the operating system for managing frame-capture streams.

`struct SCContentSharingPickerConfiguration`

An instance for configuring the system content-sharing picker.

`protocol SCContentSharingPickerObserver`

An observer protocol your app implements to receive messages from the operating system’s content picker.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpickerobserver

- ScreenCaptureKit
- SCContentSharingPickerObserver

Protocol

# SCContentSharingPickerObserver

An observer protocol your app implements to receive messages from the operating system’s content picker.

protocol SCContentSharingPickerObserver : NSObjectProtocol

## Topics

### Observing events

`func contentSharingPicker(SCContentSharingPicker, didCancelFor: SCStream?)`

Tells the observer that a sharing picker canceled selection for a stream.

**Required**

`func contentSharingPicker(SCContentSharingPicker, didUpdateWith: SCContentFilter, for: SCStream?)`

Tells the observer that a sharing picker updated the content filter for a stream.

### Observing errors

`func contentSharingPickerStartDidFailWithError(any Error)`

Tells the observer that a sharing picker was unable to start.

## Relationships

### Inherits From

- `NSObjectProtocol`

## See Also

### System content-sharing picker

`class SCContentSharingPicker`

An instance of a picker presented by the operating system for managing frame-capture streams.

`struct SCContentSharingPickerConfiguration`

An instance for configuring the system content-sharing picker.

`struct SCContentSharingPickerMode`

Available modes for selecting streaming content from a picker presented by the operating system.

---

# https://developer.apple.com/documentation/screencapturekit/scstreamerrordomain

- ScreenCaptureKit
- SCStreamErrorDomain

Global Variable

# SCStreamErrorDomain

A string representation of the error domain.

let SCStreamErrorDomain: String

## See Also

### Stream errors

`struct SCStreamError`

An instance representing a ScreenCaptureKit framework error.

---

# https://developer.apple.com/documentation/screencapturekit/scstreamerror

- ScreenCaptureKit
- SCStreamError

Structure

# SCStreamError

An instance representing a ScreenCaptureKit framework error.

struct SCStreamError

## Overview

## Topics

### Error inspection

Error code constants for framework operations.

`enum Code`

Codes for user cancellation events and errors that can occur in ScreenCaptureKit.

`static var errorDomain: String`

## Relationships

### Conforms To

- `CustomNSError`
- `Equatable`
- `Error`
- `Hashable`
- `Sendable`
- `SendableMetatype`

## See Also

### Stream errors

`let SCStreamErrorDomain: String`

A string representation of the error domain.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker).



---

# https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent)



---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentinfo)



---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle)



---

# https://developer.apple.com/documentation/screencapturekit/scdisplay)



---

# https://developer.apple.com/documentation/screencapturekit/scrunningapplication)



---

# https://developer.apple.com/documentation/screencapturekit/scwindow)



---

# https://developer.apple.com/documentation/screencapturekit/scstream)



---

# https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration)



---

# https://developer.apple.com/documentation/screencapturekit/sccontentfilter)



---

# https://developer.apple.com/documentation/screencapturekit/scstreamdelegate)



---

# https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager)



---

# https://developer.apple.com/documentation/screencapturekit/scscreenshotconfiguration)



---

# https://developer.apple.com/documentation/screencapturekit/scscreenshotoutput)



---

# https://developer.apple.com/documentation/screencapturekit/scstreamoutput)



---

# https://developer.apple.com/documentation/screencapturekit/scstreamoutputtype)



---

# https://developer.apple.com/documentation/screencapturekit/scstreamframeinfo)



---

# https://developer.apple.com/documentation/screencapturekit/scframestatus)



---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker)



---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpickerconfiguration-swift.struct)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpickermode)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpickerobserver)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scstreamerrordomain)



---

# https://developer.apple.com/documentation/screencapturekit/scstreamerror)



---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentinfo/contentrect

- ScreenCaptureKit
- SCShareableContentInfo
- contentRect

Instance Property

# contentRect

The size and location of content for the stream.

var contentRect: CGRect { get }

## See Also

### Shared content properties

`var pointPixelScale: Float`

The scaling from points to output pixel resolution for the stream.

`var style: SCShareableContentStyle`

The current presentation style of the stream.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentinfo/pointpixelscale

- ScreenCaptureKit
- SCShareableContentInfo
- pointPixelScale

Instance Property

# pointPixelScale

The scaling from points to output pixel resolution for the stream.

var pointPixelScale: Float { get }

## See Also

### Shared content properties

`var contentRect: CGRect`

The size and location of content for the stream.

`var style: SCShareableContentStyle`

The current presentation style of the stream.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentinfo/style

- ScreenCaptureKit
- SCShareableContentInfo
- style

Instance Property

# style

The current presentation style of the stream.

var style: SCShareableContentStyle { get }

## See Also

### Shared content properties

`var contentRect: CGRect`

The size and location of content for the stream.

`var pointPixelScale: Float`

The scaling from points to output pixel resolution for the stream.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentinfo/contentrect)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentinfo/pointpixelscale)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentinfo/style)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scrunningapplication/processid

- ScreenCaptureKit
- SCRunningApplication
- processID

Instance Property

# processID

The system process identifier of the app.

var processID: pid_t { get }

## See Also

### Inspecting an app

`var bundleIdentifier: String`

The unique bundle identifier of the app.

`var applicationName: String`

The display name of the app.

---

# https://developer.apple.com/documentation/screencapturekit/scrunningapplication/bundleidentifier

- ScreenCaptureKit
- SCRunningApplication
- bundleIdentifier

Instance Property

# bundleIdentifier

The unique bundle identifier of the app.

var bundleIdentifier: String { get }

## See Also

### Inspecting an app

`var processID: pid_t`

The system process identifier of the app.

`var applicationName: String`

The display name of the app.

---

# https://developer.apple.com/documentation/screencapturekit/scrunningapplication/applicationname

- ScreenCaptureKit
- SCRunningApplication
- applicationName

Instance Property

# applicationName

The display name of the app.

var applicationName: String { get }

## See Also

### Inspecting an app

`var processID: pid_t`

The system process identifier of the app.

`var bundleIdentifier: String`

The unique bundle identifier of the app.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent).



---

# https://developer.apple.com/documentation/screencapturekit/sccontentfilter).



---

# https://developer.apple.com/documentation/screencapturekit/scrunningapplication/processid)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scrunningapplication/bundleidentifier)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scrunningapplication/applicationname)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scdisplay/displayid

- ScreenCaptureKit
- SCDisplay
- displayID

Instance Property

# displayID

The Core Graphics display identifier.

var displayID: CGDirectDisplayID { get }

---

# https://developer.apple.com/documentation/screencapturekit/scdisplay/frame

- ScreenCaptureKit
- SCDisplay
- frame

Instance Property

# frame

The frame of the display.

var frame: CGRect { get }

## See Also

### Accessing dimensions

`var width: Int`

The width of the display in points.

`var height: Int`

The height of the display in points.

---

# https://developer.apple.com/documentation/screencapturekit/scdisplay/width

- ScreenCaptureKit
- SCDisplay
- width

Instance Property

# width

The width of the display in points.

var width: Int { get }

## See Also

### Accessing dimensions

`var frame: CGRect`

The frame of the display.

`var height: Int`

The height of the display in points.

---

# https://developer.apple.com/documentation/screencapturekit/scdisplay/height

- ScreenCaptureKit
- SCDisplay
- height

Instance Property

# height

The height of the display in points.

var height: Int { get }

## See Also

### Accessing dimensions

`var frame: CGRect`

The frame of the display.

`var width: Int`

The width of the display in points.

---

# https://developer.apple.com/documentation/screencapturekit/scdisplay/displayid)



---

# https://developer.apple.com/documentation/screencapturekit/scdisplay/frame)



---

# https://developer.apple.com/documentation/screencapturekit/scdisplay/width)



---

# https://developer.apple.com/documentation/screencapturekit/scdisplay/height)



---

# https://developer.apple.com/documentation/screencapturekit/scstream/init(filter:configuration:delegate:)

#app-main)

- ScreenCaptureKit
- SCStream
- init(filter:configuration:delegate:)

Initializer

# init(filter:configuration:delegate:)

Creates a stream with a content filter and configuration.

init(
filter contentFilter: SCContentFilter,
configuration streamConfig: SCStreamConfiguration,
delegate: (any SCStreamDelegate)?
)

## Parameters

`contentFilter`

The content to capture.

`streamConfig`

The configuration to apply to the stream.

`delegate`

An optional object that responds to stream events.

---

# https://developer.apple.com/documentation/screencapturekit/scstream/updateconfiguration(_:completionhandler:)

#app-main)

- ScreenCaptureKit
- SCStream
- updateConfiguration(\_:completionHandler:)

Instance Method

# updateConfiguration(\_:completionHandler:)

Updates the stream with a new configuration.

func updateConfiguration(
_ streamConfig: SCStreamConfiguration,

)
func updateConfiguration(_ streamConfig: SCStreamConfiguration) async throws

## Parameters

`streamConfig`

An object that provides the updated stream configuration.

`completionHandler`

A completion handler the system calls when this method completes. It includes an error if the update fails.

## See Also

### Updating stream configuration

Updates the stream by applying a new content filter.

---

# https://developer.apple.com/documentation/screencapturekit/scstream/updatecontentfilter(_:completionhandler:)

#app-main)

- ScreenCaptureKit
- SCStream
- updateContentFilter(\_:completionHandler:)

Instance Method

# updateContentFilter(\_:completionHandler:)

Updates the stream by applying a new content filter.

func updateContentFilter(
_ contentFilter: SCContentFilter,

)
func updateContentFilter(_ contentFilter: SCContentFilter) async throws

## Parameters

`contentFilter`

The content filter to apply.

`completionHandler`

A completion handler the system calls when this method completes. It includes an error if the update fails.

## See Also

### Updating stream configuration

Updates the stream with a new configuration.

---

# https://developer.apple.com/documentation/screencapturekit/scstream/addstreamoutput(_:type:samplehandlerqueue:)

#app-main)

- ScreenCaptureKit
- SCStream
- addStreamOutput(\_:type:sampleHandlerQueue:)

Instance Method

# addStreamOutput(\_:type:sampleHandlerQueue:)

Adds a destination that receives the stream output.

func addStreamOutput(
_ output: any SCStreamOutput,
type: SCStreamOutputType,
sampleHandlerQueue: dispatch_queue_t?
) throws

## Parameters

`output`

The object that conforms to the stream output protocol.

`type`

The stream output type.

`sampleHandlerQueue`

The queue that receives the stream output.

## Discussion

Use this method to attach an object that conforms to `SCStreamOutput` to receive stream content. Optionally, provide a `DispatchQueue` to send output to a queue that’s responsible for processing the output.

## See Also

### Adding and removing stream output

`func removeStreamOutput(any SCStreamOutput, type: SCStreamOutputType) throws`

Removes a destination from receiving stream output.

---

# https://developer.apple.com/documentation/screencapturekit/scstream/removestreamoutput(_:type:)

#app-main)

- ScreenCaptureKit
- SCStream
- removeStreamOutput(\_:type:)

Instance Method

# removeStreamOutput(\_:type:)

Removes a destination from receiving stream output.

func removeStreamOutput(
_ output: any SCStreamOutput,
type: SCStreamOutputType
) throws

## Parameters

`output`

The object to remove that conforms to the stream output protocol.

`type`

The stream output type.

## See Also

### Adding and removing stream output

`func addStreamOutput(any SCStreamOutput, type: SCStreamOutputType, sampleHandlerQueue: dispatch_queue_t?) throws`

Adds a destination that receives the stream output.

---

# https://developer.apple.com/documentation/screencapturekit/scstream/addrecordingoutput(_:)

#app-main)

- ScreenCaptureKit
- SCStream
- addRecordingOutput(\_:)

Instance Method

# addRecordingOutput(\_:)

func addRecordingOutput(_ recordingOutput: SCRecordingOutput) throws

## See Also

### Adding and removing recording output

`func removeRecordingOutput(SCRecordingOutput) throws`

`class SCRecordingOutput`

---

# https://developer.apple.com/documentation/screencapturekit/scstream/removerecordingoutput(_:)

#app-main)

- ScreenCaptureKit
- SCStream
- removeRecordingOutput(\_:)

Instance Method

# removeRecordingOutput(\_:)

func removeRecordingOutput(_ recordingOutput: SCRecordingOutput) throws

## See Also

### Adding and removing recording output

`func addRecordingOutput(SCRecordingOutput) throws`

`class SCRecordingOutput`

---

# https://developer.apple.com/documentation/screencapturekit/screcordingoutput

- ScreenCaptureKit
- SCRecordingOutput

Class

# SCRecordingOutput

class SCRecordingOutput

## Topics

### Creating a recording output

`init(configuration: SCRecordingOutputConfiguration, delegate: any SCRecordingOutputDelegate)`

`class SCRecordingOutputConfiguration`

`protocol SCRecordingOutputDelegate`

### Configuring the recording output

`var recordedDuration: CMTime`

`var recordedFileSize: Int`

## Relationships

### Inherits From

- `NSObject`

### Conforms To

- `CVarArg`
- `CustomDebugStringConvertible`
- `CustomStringConvertible`
- `Equatable`
- `Hashable`
- `NSObjectProtocol`

## See Also

### Adding and removing recording output

`func addRecordingOutput(SCRecordingOutput) throws`

`func removeRecordingOutput(SCRecordingOutput) throws`

---

# https://developer.apple.com/documentation/screencapturekit/scstream/startcapture(completionhandler:)

#app-main)

- ScreenCaptureKit
- SCStream
- startCapture(completionHandler:)

Instance Method

# startCapture(completionHandler:)

Starts the stream with a call\#parameters)

`completionHandler`

A completion handler that provides an error if the stream fails to start.

## See Also

### Starting and stopping a stream

Stops the stream.

---

# https://developer.apple.com/documentation/screencapturekit/scstream/stopcapture(completionhandler:)

#app-main)

- ScreenCaptureKit
- SCStream
- stopCapture(completionHandler:)

Instance Method

# stopCapture(completionHandler:)

Stops the stream.

func stopCapture() async throws

## Parameters

`completionHandler`

A completion handler that provides an error if the stream fails to stop.

## See Also

### Starting and stopping a stream

Starts the stream with a call

---

# https://developer.apple.com/documentation/screencapturekit/scstream/synchronizationclock

- ScreenCaptureKit
- SCStream
- synchronizationClock

Instance Property

# synchronizationClock

A clock to use for output synchronization.

var synchronizationClock: CMClock? { get }

## Discussion

The synchronization clock provides the timebase for sample buffers that the stream outputs. Use it to synchronize with the clocks of other media sources, such as the `synchronizationClock` of `AVCaptureSession`.

---

# https://developer.apple.com/documentation/screencapturekit/scstream/init(filter:configuration:delegate:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scstream/updateconfiguration(_:completionhandler:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scstream/updatecontentfilter(_:completionhandler:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scstream/addstreamoutput(_:type:samplehandlerqueue:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scstream/removestreamoutput(_:type:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scstream/addrecordingoutput(_:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scstream/removerecordingoutput(_:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/screcordingoutput)



---

# https://developer.apple.com/documentation/screencapturekit/scstream/startcapture(completionhandler:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scstream/stopcapture(completionhandler:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scstream/synchronizationclock)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/displays

- ScreenCaptureKit
- SCShareableContent
- displays

Instance Property

# displays

The displays available for capture.

var displays: [SCDisplay] { get }

## See Also

### Inspecting shareable content

[`var windows: [SCWindow]`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/windows)

The windows available for capture.

[`var applications: [SCRunningApplication]`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/applications)

The apps available for capture.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/windows

- ScreenCaptureKit
- SCShareableContent
- windows

Instance Property

# windows

The windows available for capture.

var windows: [SCWindow] { get }

## See Also

### Inspecting shareable content

[`var displays: [SCDisplay]`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/displays)

The displays available for capture.

[`var applications: [SCRunningApplication]`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/applications)

The apps available for capture.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/applications

- ScreenCaptureKit
- SCShareableContent
- applications

Instance Property

# applications

The apps available for capture.

var applications: [SCRunningApplication] { get }

## See Also

### Inspecting shareable content

[`var windows: [SCWindow]`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/windows)

The windows available for capture.

[`var displays: [SCDisplay]`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent/displays)

The displays available for capture.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getwithcompletionhandler(_:)

#app-main)

- ScreenCaptureKit
- SCShareableContent
- getWithCompletionHandler(\_:)

Type Method

# getWithCompletionHandler(\_:)

Retrieves the displays, apps, and windows that your app can capture.

class var current: SCShareableContent { get async throws }

## Parameters

`completionHandler`

A callback the system invokes with the shareable content, or an error if a failure occurs.

## Discussion

Use this method to retrieve the onscreen content that your app can capture. If the call is successful, the system returns the shareable content to the completion handler; otherwise, it returns an error that describes the failure.

## See Also

### Retrieving shareable content

Retrieves the displays, apps, and windows that match your criteria.

Retrieves the displays, apps, and windows that are in front of the specified window.

Retrieves the displays, apps, and windows that are behind the specified window.

Retrieves any available sharable content information that matches the provided filter.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getexcludingdesktopwindows(_:onscreenwindowsonly:completionhandler:)

#app-main)

- ScreenCaptureKit
- SCShareableContent
- getExcludingDesktopWindows(\_:onScreenWindowsOnly:completionHandler:)

Type Method

# getExcludingDesktopWindows(\_:onScreenWindowsOnly:completionHandler:)

Retrieves the displays, apps, and windows that match your criteria.

class func getExcludingDesktopWindows(
_ excludeDesktopWindows: Bool,
onScreenWindowsOnly: Bool,

)
class func excludingDesktopWindows(
_ excludeDesktopWindows: Bool,
onScreenWindowsOnly: Bool

## Parameters

`excludeDesktopWindows`

A Boolean value that indicates whether to exclude desktop windows like Finder, Dock, and Desktop from the set of shareable content.

`onScreenWindowsOnly`

A Boolean value that indicates whether to include only onscreen windows in the set of shareable content.

`completionHandler`

A callback the system invokes with the shareable content, or an error if a failure occurs.

## Discussion

Use this method to retrieve the onscreen content matching your filtering criteria. If the call is successful, the system passes an `SCShareableContent` instance to the completion handler; otherwise, it returns an error that describes the failure.

## See Also

### Retrieving shareable content

Retrieves the displays, apps, and windows that your app can capture.

Retrieves the displays, apps, and windows that are in front of the specified window.

Retrieves the displays, apps, and windows that are behind the specified window.

Retrieves any available sharable content information that matches the provided filter.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getexcludingdesktopwindows(_:onscreenwindowsonlyabove:completionhandler:)

#app-main)

- ScreenCaptureKit
- SCShareableContent
- getExcludingDesktopWindows(\_:onScreenWindowsOnlyAbove:completionHandler:)

Type Method

# getExcludingDesktopWindows(\_:onScreenWindowsOnlyAbove:completionHandler:)

Retrieves the displays, apps, and windows that are in front of the specified window.

class func getExcludingDesktopWindows(
_ excludeDesktopWindows: Bool,
onScreenWindowsOnlyAbove window: SCWindow,

)
class func excludingDesktopWindows(
_ excludeDesktopWindows: Bool,
onScreenWindowsOnlyAbove window: SCWindow

## Parameters

`excludeDesktopWindows`

A Boolean value that indicates whether to exclude desktop windows like Finder, Dock, and Desktop from the set of shareable content.

`window`

The window above which to retrieve shareable content.

`completionHandler`

A callback the system invokes with the shareable content, or an error if a failure occurs.

## Discussion

Use this method to retrieve the onscreen content matching your filtering criteria. If the call is successful, the system passes an `SCShareableContent` instance to the completion handler; otherwise, it returns an error that describes the failure.

## See Also

### Retrieving shareable content

Retrieves the displays, apps, and windows that your app can capture.

Retrieves the displays, apps, and windows that match your criteria.

Retrieves the displays, apps, and windows that are behind the specified window.

Retrieves any available sharable content information that matches the provided filter.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getexcludingdesktopwindows(_:onscreenwindowsonlybelow:completionhandler:)

#app-main)

- ScreenCaptureKit
- SCShareableContent
- getExcludingDesktopWindows(\_:onScreenWindowsOnlyBelow:completionHandler:)

Type Method

# getExcludingDesktopWindows(\_:onScreenWindowsOnlyBelow:completionHandler:)

Retrieves the displays, apps, and windows that are behind the specified window.

class func getExcludingDesktopWindows(
_ excludeDesktopWindows: Bool,
onScreenWindowsOnlyBelow window: SCWindow,

)
class func excludingDesktopWindows(
_ excludeDesktopWindows: Bool,
onScreenWindowsOnlyBelow window: SCWindow

## Parameters

`excludeDesktopWindows`

A Boolean value that indicates whether to exclude desktop windows from the set of shareable content.

`window`

The window above which to retrieve shareable content.

`completionHandler`

A callback the system invokes with the shareable content, or an error if a failure occurs.

## Discussion

Use this method to retrieve the onscreen content matching your filtering criteria. If the call is successful, the system passes an `SCShareableContent` instance to the completion handler; otherwise, it returns an error that describes the failure.

## See Also

### Retrieving shareable content

Retrieves the displays, apps, and windows that your app can capture.

Retrieves the displays, apps, and windows that match your criteria.

Retrieves the displays, apps, and windows that are in front of the specified window.

Retrieves any available sharable content information that matches the provided filter.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/info(for:)

#app-main)

- ScreenCaptureKit
- SCShareableContent
- info(for:)

Type Method

# info(for:)

Retrieves any available sharable content information that matches the provided filter.

## Parameters

`filter`

The filter to match current sharable content against.

## Return Value

The sharable content matching the filter, or `nil` if none is found.

## See Also

### Retrieving shareable content

Retrieves the displays, apps, and windows that your app can capture.

Retrieves the displays, apps, and windows that match your criteria.

Retrieves the displays, apps, and windows that are in front of the specified window.

Retrieves the displays, apps, and windows that are behind the specified window.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getcurrentprocessshareablecontent(completionhandler:)

#app-main)

- ScreenCaptureKit
- SCShareableContent
- getCurrentProcessShareableContent(completionHandler:)

Type Method

# getCurrentProcessShareableContent(completionHandler:)

class var currentProcess: SCShareableContent { get async throws }

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/displays),

,#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/windows),

,#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/applications)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getwithcompletionhandler(_:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getexcludingdesktopwindows(_:onscreenwindowsonly:completionhandler:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getexcludingdesktopwindows(_:onscreenwindowsonlyabove:completionhandler:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getexcludingdesktopwindows(_:onscreenwindowsonlybelow:completionhandler:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/info(for:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/windows)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/displays)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontent/getcurrentprocessshareablecontent(completionhandler:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scwindow/windowid

- ScreenCaptureKit
- SCWindow
- windowID

Instance Property

# windowID

The Core Graphics window identifier.

var windowID: CGWindowID { get }

## See Also

### Identifying windows

`var title: String?`

The string that displays in a window’s title bar.

`var owningApplication: SCRunningApplication?`

The app that owns the window.

`var windowLayer: Int`

The layer of the window relative to other windows.

---

# https://developer.apple.com/documentation/screencapturekit/scwindow/title

- ScreenCaptureKit
- SCWindow
- title

Instance Property

# title

The string that displays in a window’s title bar.

var title: String? { get }

## See Also

### Identifying windows

`var windowID: CGWindowID`

The Core Graphics window identifier.

`var owningApplication: SCRunningApplication?`

The app that owns the window.

`var windowLayer: Int`

The layer of the window relative to other windows.

---

# https://developer.apple.com/documentation/screencapturekit/scwindow/owningapplication

- ScreenCaptureKit
- SCWindow
- owningApplication

Instance Property

# owningApplication

The app that owns the window.

var owningApplication: SCRunningApplication? { get }

## See Also

### Identifying windows

`var windowID: CGWindowID`

The Core Graphics window identifier.

`var title: String?`

The string that displays in a window’s title bar.

`var windowLayer: Int`

The layer of the window relative to other windows.

---

# https://developer.apple.com/documentation/screencapturekit/scwindow/windowlayer

- ScreenCaptureKit
- SCWindow
- windowLayer

Instance Property

# windowLayer

The layer of the window relative to other windows.

var windowLayer: Int { get }

## See Also

### Identifying windows

`var windowID: CGWindowID`

The Core Graphics window identifier.

`var title: String?`

The string that displays in a window’s title bar.

`var owningApplication: SCRunningApplication?`

The app that owns the window.

---

# https://developer.apple.com/documentation/screencapturekit/scwindow/frame

- ScreenCaptureKit
- SCWindow
- frame

Instance Property

# frame

A rectangle the represents the frame of the window within a display.

var frame: CGRect { get }

---

# https://developer.apple.com/documentation/screencapturekit/scwindow/isonscreen

- ScreenCaptureKit
- SCWindow
- isOnScreen

Instance Property

# isOnScreen

A Boolean value that indicates whether the window is on screen.

var isOnScreen: Bool { get }

## Discussion

This value represents the macOS window server’s onscreen status of the window.

## See Also

### Determining visibility

`var isActive: Bool`

A Boolean value that indicates if the window is currently streaming.

---

# https://developer.apple.com/documentation/screencapturekit/scwindow/isactive

- ScreenCaptureKit
- SCWindow
- isActive

Instance Property

# isActive

A Boolean value that indicates if the window is currently streaming.

var isActive: Bool { get }

## Discussion

When this value is `true`, the window is currently streaming, even if offscreen.

## See Also

### Determining visibility

`var isOnScreen: Bool`

A Boolean value that indicates whether the window is on screen.

---

# https://developer.apple.com/documentation/screencapturekit/scwindow/windowid)



---

# https://developer.apple.com/documentation/screencapturekit/scwindow/title)



---

# https://developer.apple.com/documentation/screencapturekit/scwindow/owningapplication)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scwindow/windowlayer)



---

# https://developer.apple.com/documentation/screencapturekit/scwindow/frame)



---

# https://developer.apple.com/documentation/screencapturekit/scwindow/isonscreen)



---

# https://developer.apple.com/documentation/screencapturekit/scwindow/isactive)



---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/shared

- ScreenCaptureKit
- SCContentSharingPicker
- shared

Type Property

# shared

The system-provided picker UI instance for capturing display and audio content from someone’s Mac.

class var shared: SCContentSharingPicker { get }

## Discussion

The picker gives a person control over what information on their Mac they wish to let your app view or record such as specific applications, displays, and windows.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/isactive

- ScreenCaptureKit
- SCContentSharingPicker
- isActive

Instance Property

# isActive

A Boolean value that indicates if the picker is active.

var isActive: Bool { get set }

## Discussion

When this value is `true`, the capture stream picker is active, available for managing capture. The default value is `false`.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/setconfiguration(_:for:)

#app-main)

- ScreenCaptureKit
- SCContentSharingPicker
- setConfiguration(\_:for:)

Instance Method

# setConfiguration(\_:for:)

Sets the configuration for the content capture picker for a capture stream, providing allowed selection modes and content excluded from selection.

func setConfiguration(
_ configuration: SCContentSharingPickerConfiguration?,
for stream: SCStream
)

## Parameters

`configuration`

The configuration to set for the given capture stream. When this value is `nil`, changes the stream configuration to use `defaultConfiguration`.

`stream`

The capture stream to set a configuration for. When this value is `nil`, applies to all currently active streams.

## See Also

### Stream configuration

`var configuration: SCContentSharingPickerConfiguration?`

Sets the configuration for the content capture picker for all streams, providing allowed selection modes and content excluded from selection.

`var defaultConfiguration: SCContentSharingPickerConfiguration`

The default configuration to use for the content capture picker.

`var maximumStreamCount: Int?`

The maximum number of streams the content capture picker allows.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/configuration

- ScreenCaptureKit
- SCContentSharingPicker
- configuration

Instance Property

# configuration

Sets the configuration for the content capture picker for all streams, providing allowed selection modes and content excluded from selection.

var configuration: SCContentSharingPickerConfiguration? { get set }

## See Also

### Stream configuration

`func setConfiguration(SCContentSharingPickerConfiguration?, for: SCStream)`

Sets the configuration for the content capture picker for a capture stream, providing allowed selection modes and content excluded from selection.

`var defaultConfiguration: SCContentSharingPickerConfiguration`

The default configuration to use for the content capture picker.

`var maximumStreamCount: Int?`

The maximum number of streams the content capture picker allows.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/defaultconfiguration-94q2b

- ScreenCaptureKit
- SCContentSharingPicker
- defaultConfiguration

Instance Property

# defaultConfiguration

The default configuration to use for the content capture picker.

var defaultConfiguration: SCContentSharingPickerConfiguration { get set }

## See Also

### Stream configuration

`func setConfiguration(SCContentSharingPickerConfiguration?, for: SCStream)`

Sets the configuration for the content capture picker for a capture stream, providing allowed selection modes and content excluded from selection.

`var configuration: SCContentSharingPickerConfiguration?`

Sets the configuration for the content capture picker for all streams, providing allowed selection modes and content excluded from selection.

`var maximumStreamCount: Int?`

The maximum number of streams the content capture picker allows.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/maximumstreamcount-2kuaa

- ScreenCaptureKit
- SCContentSharingPicker
- maximumStreamCount

Instance Property

# maximumStreamCount

The maximum number of streams the content capture picker allows.

var maximumStreamCount: Int? { get set }

## Discussion

The default value is `1`.

## See Also

### Stream configuration

`func setConfiguration(SCContentSharingPickerConfiguration?, for: SCStream)`

Sets the configuration for the content capture picker for a capture stream, providing allowed selection modes and content excluded from selection.

`var configuration: SCContentSharingPickerConfiguration?`

Sets the configuration for the content capture picker for all streams, providing allowed selection modes and content excluded from selection.

`var defaultConfiguration: SCContentSharingPickerConfiguration`

The default configuration to use for the content capture picker.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/add(_:)

#app-main)

- ScreenCaptureKit
- SCContentSharingPicker
- add(\_:)

Instance Method

# add(\_:)

Adds an observer instance to notify of changes in the content-sharing picker.

func add(_ observer: any SCContentSharingPickerObserver)

## Parameters

`observer`

The observer instance to send notifications to.

## See Also

### Manage observers

`func remove(any SCContentSharingPickerObserver)`

Removes an observer instance from the content-sharing picker.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/remove(_:)

#app-main)

- ScreenCaptureKit
- SCContentSharingPicker
- remove(\_:)

Instance Method

# remove(\_:)

Removes an observer instance from the content-sharing picker.

func remove(_ observer: any SCContentSharingPickerObserver)

## Parameters

`observer`

The observer instance to remove.

## See Also

### Manage observers

`func add(any SCContentSharingPickerObserver)`

Adds an observer instance to notify of changes in the content-sharing picker.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/present()

#app-main)

- ScreenCaptureKit
- SCContentSharingPicker
- present()

Instance Method

# present()

Displays the picker with no active selection for capture.

func present()

## See Also

### Picker display

`func present(for: SCStream)`

Displays the picker with an already running capture stream.

`func present(using: SCShareableContentStyle)`

Displays the picker for a single type of capture selection.

`func present(for: SCStream, using: SCShareableContentStyle)`

Displays the picker with an existing capture stream, allowing for a single type of capture selection.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/present(for:)

#app-main)

- ScreenCaptureKit
- SCContentSharingPicker
- present(for:)

Instance Method

# present(for:)

Displays the picker with an already running capture stream.

func present(for stream: SCStream)

## Parameters

`stream`

The capture stream to display in the picker.

## See Also

### Picker display

`func present()`

Displays the picker with no active selection for capture.

`func present(using: SCShareableContentStyle)`

Displays the picker for a single type of capture selection.

`func present(for: SCStream, using: SCShareableContentStyle)`

Displays the picker with an existing capture stream, allowing for a single type of capture selection.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/present(using:)

#app-main)

- ScreenCaptureKit
- SCContentSharingPicker
- present(using:)

Instance Method

# present(using:)

Displays the picker for a single type of capture selection.

func present(using contentStyle: SCShareableContentStyle)

## Parameters

`contentStyle`

The type of streaming content selection allowed through the presented picker.

## See Also

### Picker display

`func present()`

Displays the picker with no active selection for capture.

`func present(for: SCStream)`

Displays the picker with an already running capture stream.

`func present(for: SCStream, using: SCShareableContentStyle)`

Displays the picker with an existing capture stream, allowing for a single type of capture selection.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/present(for:using:)

#app-main)

- ScreenCaptureKit
- SCContentSharingPicker
- present(for:using:)

Instance Method

# present(for:using:)

Displays the picker with an existing capture stream, allowing for a single type of capture selection.

func present(
for stream: SCStream,
using contentStyle: SCShareableContentStyle
)

## Parameters

`stream`

The stream to display in the picker.

`contentStyle`

The type of streaming content selection allowed through the presented picker.

## See Also

### Picker display

`func present()`

Displays the picker with no active selection for capture.

`func present(for: SCStream)`

Displays the picker with an already running capture stream.

`func present(using: SCShareableContentStyle)`

Displays the picker for a single type of capture selection.

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/shared)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/isactive)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/setconfiguration(_:for:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/configuration)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/defaultconfiguration-94q2b)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/maximumstreamcount-2kuaa)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/add(_:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/remove(_:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/present())

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/present(for:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/present(using:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/sccontentsharingpicker/present(for:using:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/application

- ScreenCaptureKit
- SCShareableContentStyle
- SCShareableContentStyle.application

Case

# SCShareableContentStyle.application

The stream is currently presenting one or more applications.

case application

## See Also

### Content styles

`case display`

The stream is currently presenting a complete display.

`case none`

The stream isn’t currently presenting any content.

`case window`

The stream is currently presenting one or more windows.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/display

- ScreenCaptureKit
- SCShareableContentStyle
- SCShareableContentStyle.display

Case

# SCShareableContentStyle.display

The stream is currently presenting a complete display.

case display

## See Also

### Content styles

`case application`

The stream is currently presenting one or more applications.

`case none`

The stream isn’t currently presenting any content.

`case window`

The stream is currently presenting one or more windows.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/none

- ScreenCaptureKit
- SCShareableContentStyle
- SCShareableContentStyle.none

Case

# SCShareableContentStyle.none

The stream isn’t currently presenting any content.

case none

## See Also

### Content styles

`case application`

The stream is currently presenting one or more applications.

`case display`

The stream is currently presenting a complete display.

`case window`

The stream is currently presenting one or more windows.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/window

- ScreenCaptureKit
- SCShareableContentStyle
- SCShareableContentStyle.window

Case

# SCShareableContentStyle.window

The stream is currently presenting one or more windows.

case window

## See Also

### Content styles

`case application`

The stream is currently presenting one or more applications.

`case display`

The stream is currently presenting a complete display.

`case none`

The stream isn’t currently presenting any content.

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/init(rawvalue:)

#app-main)

- ScreenCaptureKit
- SCShareableContentStyle
- init(rawValue:)

Initializer

# init(rawValue:)

init?(rawValue: Int)

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/application)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/display)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/none)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/window)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

# https://developer.apple.com/documentation/screencapturekit/scshareablecontentstyle/init(rawvalue:))

)#app-main)

# The page you're looking for can't be found.

Search developer.apple.comSearch Icon

---

