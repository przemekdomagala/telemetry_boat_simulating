const WebSocket = require('ws');
const rclnodejs = require('rclnodejs');
const { createCanvas, ImageData } = require('canvas');
const wrtc = require('wrtc');

//ROS 2 WebRTC Client that connects to a ZED camera image topic and streams images via WebRTC.
class ROS2WebRTCClient {
    constructor() {
        this.rosNode = null;
        this.imageSubscription = null;
        this.currentImageData = null;
        this.signalingSocket = null;
        this.canvas = null;
        this.ctx = null;
        this.peerConnection = null;
        this.dataChannel = null;
        
        this.isRosConnected = false;
        this.isStreamingActive = false;
        this.autoStartStreaming = true;
        this.lastImageTime = null;
        this.imageTimeoutChecker = null;
        
        this.initializeROS2();
    }
    
    // Initialize ROS 2 connection
    async initializeROS2() {
        try {
            console.log('Initializing ROS 2 connection...');
            
            await rclnodejs.init();
            
            this.rosNode = rclnodejs.createNode('webrtc_zed_client');
            
            this.imageSubscription = this.rosNode.createSubscription(
                'sensor_msgs/msg/Image',
                '/zed/zed_node/left/image_rect_color',
                (msg) => {
                    this.handleROSImage(msg);
                },
                console.log('Subscribed to ZED camera topic')
            );
            
            rclnodejs.spin(this.rosNode);
            this.isRosConnected = true;
            
            console.log('ROS 2 connection established');
            
            if (this.autoStartStreaming) {
                console.log('Auto-starting WebRTC stream...');
                setTimeout(() => this.startWebRTCStream(), 1000); 
            }
            
        } catch (error) {
            console.error('ROS 2 initialization failed:', error);
            console.log('Make sure ROS 2 Humble is sourced and ZED node is running');
            this.isRosConnected = false;
        }
    }
    
    // Handle incoming ROS image messages
    handleROSImage(imageMsg) {
        try {
            this.lastImageTime = Date.now();
            
            const { width, height, data, encoding } = imageMsg;
            
            if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas = createCanvas(width, height);
                this.ctx = this.canvas.getContext('2d');
            }
            const canvas = this.canvas;
            const ctx = this.ctx;
            
            this.drawBGRA8ToCanvas(ctx, data, width, height);
    
            const base64Image = canvas.toDataURL('image/jpeg', 0.8);
            
            this.currentImageData = {
                base64: base64Image,
                width: width,
                height: height,
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error('Error processing ROS image:', error);
        }
    }
    
    // Convert BGRA8 data to Canvas ImageData and draw
    drawBGRA8ToCanvas(ctx, data, width, height) {
        const imageData = ctx.createImageData(width, height);
        for (let i = 0; i < data.length; i += 4) {
            const pixelIndex = i;
            imageData.data[pixelIndex] = data[i + 2];     
            imageData.data[pixelIndex + 1] = data[i + 1];
            imageData.data[pixelIndex + 2] = data[i];     
            imageData.data[pixelIndex + 3] = data[i + 3]; 
        }
        ctx.putImageData(imageData, 0, 0);
    }
    
    // Start WebRTC streaming
    startWebRTCStream() {
        if (this.isStreamingActive) return;
        
        console.log('Starting WebRTC stream with ROS 2 images...');
        
        let SIGNALING_SERVER = process.env.SIGNALING_SERVER || 'ws://localhost:8000/ws/signaling';
        
        if (!SIGNALING_SERVER.startsWith('ws://') && !SIGNALING_SERVER.startsWith('wss://')) {
            SIGNALING_SERVER = 'ws://' + SIGNALING_SERVER;
        }
        
        if (!SIGNALING_SERVER.endsWith('/ws/signaling')) {
            SIGNALING_SERVER = SIGNALING_SERVER + '/ws/signaling';
        }
        
        console.log('Connecting to signaling server at:', SIGNALING_SERVER);
        this.signalingSocket = new WebSocket(SIGNALING_SERVER);
        
        this.signalingSocket.on('open', () => {
            console.log('Connected to WebRTC signaling server');
            this.sendMessage('identify', { type: 'sender' });
        });
        
        this.signalingSocket.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleSignalingMessage(message);
            } catch (error) {
                console.error('Error parsing signaling message:', error);
            }
        });
        
        this.signalingSocket.on('close', () => {
            console.log('Disconnected from signaling server');
            this.stopWebRTCStream();
                
            setTimeout(() => {
                if (!this.isStreamingActive && this.isRosConnected) {
                    console.log('Attempting to reconnect...');
                    this.startWebRTCStream();
                }
            }, 1000);
        });
        
        this.signalingSocket.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    }
    
    // Send message via signaling WebSocket
    sendMessage(event, data) {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(JSON.stringify({ event, data }));
        }
    }
    
    // Handle signaling messages from WebSocket
    async handleSignalingMessage(message) {
        const { event, data } = message;
        
        switch (event) {
            case 'paired':
                console.log('Paired with WebRTC receiver:', data.peerId);
                await this.setupWebRTCConnection();
                break;
                
            case 'answer':
                console.log('Received WebRTC answer');
                try {
                    await this.peerConnection.setRemoteDescription(
                        new wrtc.RTCSessionDescription(data.answer)
                    );
                    console.log('WebRTC connection established!');
                } catch (error) {
                    console.error('Error setting remote description:', error);
                }
                break;
                
            case 'ice-candidate':
                try {
                    if (this.peerConnection && data.candidate) {
                        if (data.candidate.candidate && data.candidate.candidate.trim() !== '') {
                            await this.peerConnection.addIceCandidate(
                                new wrtc.RTCIceCandidate(data.candidate)
                            );
                        }
                    }
                } catch (error) {
                    console.error('Error adding ICE candidate:', error);
                }
                break;
                
            case 'peer-disconnected':
                console.log('Receiver disconnected');
                this.stopWebRTCStream();
                break;
        }
    }
    
    // Setup WebRTC connection and data channel
    async setupWebRTCConnection() {
        try {
            this.peerConnection = new wrtc.RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });
            
            this.dataChannel = this.peerConnection.createDataChannel('images', {
                ordered: false, 
                maxRetransmits: 0 
            });
            
            this.dataChannel.onopen = () => {
                console.log('Data channel opened - starting image streaming');
                this.isStreamingActive = true;
                this.startImageStreaming();
                this.startImageTimeoutMonitor();
            };
            
            this.dataChannel.onclose = () => {
                console.log('Data channel closed');
                this.isStreamingActive = false;
            };
            
            this.dataChannel.onerror = (error) => {
                console.error('Data channel error:', error);
            };
            
            this.dataChannel.onbufferedamountlow = () => {
                
            };
            
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendMessage('ice-candidate', {
                        candidate: event.candidate
                    });
                }
            };
            
            this.peerConnection.onconnectionstatechange = () => {
                if (!this.peerConnection) return;
                console.log('Connection state:', this.peerConnection.connectionState);
                if (this.peerConnection.connectionState === 'failed' || 
                    this.peerConnection.connectionState === 'disconnected') {
                    this.stopWebRTCStream();
                }
            };
            
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.sendMessage('offer', { offer: offer });
            console.log('WebRTC offer sent');
            
        } catch (error) {
            console.error('Error setting up WebRTC connection:', error);
        }
    }
    
    // Monitor for image timeouts to stop stream if no images received
    startImageTimeoutMonitor() {
        const IMAGE_TIMEOUT = 30000; 
        
        if (this.imageTimeoutChecker) {
            clearInterval(this.imageTimeoutChecker);
        }
        
        this.imageTimeoutChecker = setInterval(() => {
            if (this.lastImageTime && this.isStreamingActive) {
                const timeSinceLastImage = Date.now() - this.lastImageTime;
                if (timeSinceLastImage > IMAGE_TIMEOUT) {
                    console.log('No images received for 30s - stopping stream');
                    this.stopWebRTCStream();
                }
            }
        }, 5000); 
    }
    
    // Continuously send images over data channel
    startImageStreaming() {
        this.imageStreamInterval = setInterval(() => {
            if (this.currentImageData && this.dataChannel && 
                this.dataChannel.readyState === 'open' && this.isStreamingActive) {
                
                const maxBufferedAmount = 16 * 1024 * 1024; 
                if (this.dataChannel.bufferedAmount < maxBufferedAmount) {
                    try {
                        const message = JSON.stringify(this.currentImageData);
                        this.dataChannel.send(message);
                    } catch (error) {
                        console.error('Error sending image over data channel:', error);
                    }
                }
            }
        }, 33); 
        
        console.log('Started continuous image streaming via WebRTC data channel');
    }
    
    // Stop WebRTC streaming and clean up resources
    stopWebRTCStream() {
        if (!this.isStreamingActive && !this.peerConnection && !this.signalingSocket) {
            return; 
        }
        
        console.log('Stopping WebRTC stream...');
        
        this.isStreamingActive = false;
        
        if (this.imageStreamInterval) {
            clearInterval(this.imageStreamInterval);
            this.imageStreamInterval = null;
        }
        
        if (this.imageTimeoutChecker) {
            clearInterval(this.imageTimeoutChecker);
            this.imageTimeoutChecker = null;
        }
        
        if (this.dataChannel) {
            try {
                this.dataChannel.close();
            } catch (e) { /* */ }
            this.dataChannel = null;
        }
        
        if (this.peerConnection) {
            try {
                
                this.peerConnection.onconnectionstatechange = null;
                this.peerConnection.onicecandidate = null;
                this.peerConnection.close();
            } catch (e) { /* */ }
            this.peerConnection = null;
        }
        
        if (this.signalingSocket) {
            try {
                this.signalingSocket.close();
            } catch (e) { /* */ }
            this.signalingSocket = null;
        }
    }
    
    async start() {
        const SIGNALING_SERVER = process.env.SIGNALING_SERVER || 'ws://localhost:8000/ws/signaling';
        console.log('ROS 2 WebRTC Client starting...');
        console.log('Listening for ZED camera images on: /zed/zed_node/left/image_rect_color');
        console.log('Signaling server:', SIGNALING_SERVER);
        console.log('Mode: AUTOMATIC - Will stream when images detected');
    }
    
    async shutdown() {
        console.log('Shutting down ROS 2 WebRTC Client...');
        
        this.stopWebRTCStream();
        
        if (this.rosNode) {
            this.rosNode.destroy();
        }
        
        if (rclnodejs.isShutdown() === false) {
            await rclnodejs.shutdown();
        }
        
        process.exit(0);
    }
}

const ros2Client = new ROS2WebRTCClient();

process.on('SIGINT', () => ros2Client.shutdown());
process.on('SIGTERM', () => ros2Client.shutdown());

ros2Client.start().catch(console.error);