import { InMemoryTransport } from "./inMemory.js";
describe("InMemoryTransport", () => {
    let clientTransport;
    let serverTransport;
    beforeEach(() => {
        [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    });
    test("should create linked pair", () => {
        expect(clientTransport).toBeDefined();
        expect(serverTransport).toBeDefined();
    });
    test("should start without error", async () => {
        await expect(clientTransport.start()).resolves.not.toThrow();
        await expect(serverTransport.start()).resolves.not.toThrow();
    });
    test("should send message from client to server", async () => {
        const message = {
            jsonrpc: "2.0",
            method: "test",
            id: 1,
        };
        let receivedMessage;
        serverTransport.onmessage = (msg) => {
            receivedMessage = msg;
        };
        await clientTransport.send(message);
        expect(receivedMessage).toEqual(message);
    });
    test("should send message from server to client", async () => {
        const message = {
            jsonrpc: "2.0",
            method: "test",
            id: 1,
        };
        let receivedMessage;
        clientTransport.onmessage = (msg) => {
            receivedMessage = msg;
        };
        await serverTransport.send(message);
        expect(receivedMessage).toEqual(message);
    });
    test("should handle close", async () => {
        let clientClosed = false;
        let serverClosed = false;
        clientTransport.onclose = () => {
            clientClosed = true;
        };
        serverTransport.onclose = () => {
            serverClosed = true;
        };
        await clientTransport.close();
        expect(clientClosed).toBe(true);
        expect(serverClosed).toBe(true);
    });
    test("should throw error when sending after close", async () => {
        await clientTransport.close();
        await expect(clientTransport.send({ jsonrpc: "2.0", method: "test", id: 1 })).rejects.toThrow("Not connected");
    });
    test("should queue messages sent before start", async () => {
        const message = {
            jsonrpc: "2.0",
            method: "test",
            id: 1,
        };
        let receivedMessage;
        serverTransport.onmessage = (msg) => {
            receivedMessage = msg;
        };
        await clientTransport.send(message);
        await serverTransport.start();
        expect(receivedMessage).toEqual(message);
    });
});
//# sourceMappingURL=inMemory.test.js.map