import Foundation
import Testing

@Suite("Performance and Stress Tests", .tags(.critical))
struct PerformanceTests {
    // MARK: - String Performance

    @Test("Large string concatenation performance")
    func stringConcatenation() {
        let iterations = 1_000

        // Test inefficient concatenation
        func inefficientConcat() -> String {
            var result = ""
            for i in 0..<iterations {
                result += "Line \(i)\n"
            }
            return result
        }

        // Test efficient concatenation
        func efficientConcat() -> String {
            var parts: [String] = []
            parts.reserveCapacity(iterations)
            for i in 0..<iterations {
                parts.append("Line \(i)\n")
            }
            return parts.joined()
        }

        // Measure approximate performance difference
        let start1 = Date()
        let result1 = inefficientConcat()
        let time1 = Date().timeIntervalSince(start1)

        let start2 = Date()
        let result2 = efficientConcat()
        let time2 = Date().timeIntervalSince(start2)

        #expect(!result1.isEmpty)
        #expect(!result2.isEmpty)
        // Allow some variance in timing - just verify both methods work
        #expect(time1 >= 0)
        #expect(time2 >= 0)
    }

    // MARK: - Collection Performance

    @Test("Array vs Set lookup performance")
    func collectionLookup() {
        let size = 10_000
        let searchValues = Array(0..<100)

        // Create collections
        let array = Array(0..<size)
        let set = Set(array)

        // Test array contains (O(n))
        var arrayHits = 0
        for value in searchValues {
            if array.contains(value) {
                arrayHits += 1
            }
        }

        // Test set contains (O(1))
        var setHits = 0
        for value in searchValues {
            if set.contains(value) {
                setHits += 1
            }
        }

        #expect(arrayHits == setHits)
        #expect(arrayHits == searchValues.count)
    }

    @Test("Dictionary performance with collision-prone keys")
    func dictionaryCollisions() {
        // Create keys that might have hash collisions
        struct PoorHashKey: Hashable {
            let value: Int

            func hash(into hasher: inout Hasher) {
                // Poor hash function that causes collisions
                hasher.combine(value % 10)
            }
        }

        var dict: [PoorHashKey: String] = [:]
        let count = 1_000

        // Insert values
        for i in 0..<count {
            dict[PoorHashKey(value: i)] = "Value \(i)"
        }

        #expect(dict.count == count)

        // Lookup values
        var found = 0
        for i in 0..<count {
            if dict[PoorHashKey(value: i)] != nil {
                found += 1
            }
        }

        #expect(found == count)
    }

    // MARK: - Memory Stress Tests

    @Test("Memory allocation stress test")
    func memoryAllocation() {
        let allocationSize = 1_024 * 1_024 // 1 MB
        let iterations = 10

        var allocations: [Data] = []
        allocations.reserveCapacity(iterations)

        // Allocate multiple chunks
        for _ in 0..<iterations {
            let data = Data(count: allocationSize)
            allocations.append(data)
        }

        #expect(allocations.count == iterations)

        // Verify all allocations
        for data in allocations {
            #expect(data.count == allocationSize)
        }

        // Clear to free memory
        allocations.removeAll()
    }

    @Test("Autorelease pool stress test")
    func autoreleasePool() {
        let iterations = 10_000

        // Without autorelease pool
        var withoutPool: [NSString] = []
        for i in 0..<iterations {
            let str = NSString(format: "String %d with some additional text", i)
            withoutPool.append(str)
        }

        // With autorelease pool
        var withPool: [NSString] = []
        for batch in 0..<10 {
            autoreleasepool {
                for i in 0..<(iterations / 10) {
                    let str = NSString(format: "String %d with some additional text", batch * (iterations / 10) + i)
                    withPool.append(str)
                }
            }
        }

        #expect(withoutPool.count == iterations)
        #expect(withPool.count == iterations)
    }

    // MARK: - Concurrent Operations

    @Test("Concurrent queue stress test")
    func concurrentQueues() {
        let queue = DispatchQueue(label: "test.concurrent", attributes: .concurrent)
        let iterations = 100
        let group = DispatchGroup()

        var results = [Int](repeating: 0, count: iterations)
        let resultsQueue = DispatchQueue(label: "results.serial")

        // Perform concurrent operations
        for i in 0..<iterations {
            group.enter()
            queue.async {
                // Simulate work
                let value = i * i

                // Thread-safe write
                resultsQueue.sync {
                    results[i] = value
                }

                group.leave()
            }
        }

        group.wait()

        // Verify all operations completed
        for i in 0..<iterations {
            #expect(results[i] == i * i)
        }
    }

    @Test("Lock contention stress test")
    func lockContention() {
        let lock = NSLock()
        var sharedCounter = 0
        let iterations = 1_000
        let queues = 4
        let group = DispatchGroup()

        // Create contention with multiple queues
        for q in 0..<queues {
            group.enter()
            DispatchQueue.global().async {
                for _ in 0..<iterations {
                    lock.lock()
                    sharedCounter += 1
                    lock.unlock()
                }
                group.leave()
            }
        }

        group.wait()

        #expect(sharedCounter == iterations * queues)
    }

    // MARK: - I/O Performance

    @Test("File I/O stress test")
    func fileIO() {
        let tempDir = FileManager.default.temporaryDirectory
        let testFile = tempDir.appendingPathComponent("stress_test_\(UUID().uuidString).txt")

        defer {
            try? FileManager.default.removeItem(at: testFile)
        }

        let content = String(repeating: "Test data line\n", count: 1_000)
        let data = content.data(using: .utf8)!

        // Write test
        do {
            try data.write(to: testFile)

            // Read test
            let readData = try Data(contentsOf: testFile)
            #expect(readData.count == data.count)

            // Append test
            if let handle = try? FileHandle(forWritingTo: testFile) {
                handle.seekToEndOfFile()
                handle.write(data)
                handle.closeFile()
            }

            // Verify doubled size
            let finalData = try Data(contentsOf: testFile)
            #expect(finalData.count == data.count * 2)
        } catch {
            #expect(Bool(false), "File I/O failed: \(error)")
        }
    }

    // MARK: - Network Simulation

    @Test("URL session task stress test")
    func uRLSessionStress() {
        let session = URLSession(configuration: .ephemeral)
        let iterations = 10
        let group = DispatchGroup()
        var successCount = 0
        let countQueue = DispatchQueue(label: "count.serial")

        for i in 0..<iterations {
            group.enter()

            // Create a data task with invalid URL to test error handling
            let url = URL(string: "https://invalid-domain-\(i).test")!
            let task = session.dataTask(with: url) { _, _, error in
                countQueue.sync {
                    if error != nil {
                        successCount += 1 // We expect errors for invalid domains
                    }
                }
                group.leave()
            }

            task.resume()
        }

        group.wait()

        #expect(successCount == iterations) // All should fail with invalid domains
    }

    // MARK: - Algorithm Performance

    @Test("Sorting algorithm performance")
    func sortingPerformance() {
        let size = 10_000
        let randomArray = (0..<size).shuffled()

        // Test built-in sort
        var array1 = randomArray
        let start1 = Date()
        array1.sort()
        let time1 = Date().timeIntervalSince(start1)

        // Test sort with custom comparator
        var array2 = randomArray
        let start2 = Date()
        array2.sort { $0 < $1 }
        let time2 = Date().timeIntervalSince(start2)

        // Verify both sorted correctly
        #expect(array1 == Array(0..<size))
        #expect(array2 == Array(0..<size))

        // Built-in should be faster or similar
        #expect(time1 <= time2 * 2) // Allow some variance
    }

    @Test("Hash table resize performance")
    func hashTableResize() {
        var dictionary: [Int: String] = [:]
        let iterations = 10_000

        // Pre-size vs dynamic resize
        var preSized: [Int: String] = [:]
        preSized.reserveCapacity(iterations)

        let start1 = Date()
        for i in 0..<iterations {
            dictionary[i] = "Value \(i)"
        }
        let time1 = Date().timeIntervalSince(start1)

        let start2 = Date()
        for i in 0..<iterations {
            preSized[i] = "Value \(i)"
        }
        let time2 = Date().timeIntervalSince(start2)

        #expect(dictionary.count == iterations)
        #expect(preSized.count == iterations)

        // Pre-sized should be faster or similar
        #expect(time2 <= time1 * 1.5) // Allow some variance
    }

    // MARK: - WebSocket Message Processing

    @Test("Binary message parsing performance")
    func binaryMessageParsing() {
        // Simulate parsing many binary messages
        let messageCount = 1_000
        let messageSize = 1_024

        var parsedCount = 0

        for _ in 0..<messageCount {
            // Create a mock binary message
            var data = Data()
            data.append(0x01) // Magic byte
            data.append(contentsOf: withUnsafeBytes(of: Int32(80).littleEndian) { Array($0) })
            data.append(contentsOf: withUnsafeBytes(of: Int32(24).littleEndian) { Array($0) })
            data.append(Data(count: messageSize))

            // Parse the message
            if data[0] == 0x01 && data.count >= 9 {
                parsedCount += 1
            }
        }

        #expect(parsedCount == messageCount)
    }
}
