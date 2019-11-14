const MqttWs = require('azure-iot-device-mqtt').MqttWs;
const IoT = require('azure-iot-device');
const NoRetry = require('azure-iot-common').NoRetry;

const config = require('./config.json');
const iotClient = IoT.Client.fromConnectionString(config.HubConnectionString, MqttWs);

const sendTelemetryInterval = 10000;

let iotConnected = false;

iotClient.on('error', err => {
	console.error(err);
});

iotClient.on('disconnect', () => {

	iotConnected = false;

	console.log('IOT disconnected');

	// Try to riconnect
	iotConnect();
});

function onIoTConnection() {
	iotClient.setRetryPolicy(new NoRetry());
	iotConnected = true;

	console.log('IOT connected');
}


function iotConnect() {
	console.log('IOT connecting');

	iotClient.open()
		.then(() => onIoTConnection())
		.catch(err => {
			console.error("open error");

			// Here it should try to reconnect
		});
}


function sendTelemetry() {
	if (iotConnected) {
		console.log("Sending message");

		const msg = new IoT.Message(new Date().toString());
		return iotClient.sendEvent(msg)
			.then(result => {
				console.log("Message Sent:", result.transportObj.messageId);
			})
			.catch(err => {
				console.error("send error");

				// Not sure what to do here...
			})
			.then(() => {
				setTimeout(sendTelemetry, sendTelemetryInterval);
			})
	} else {
		setTimeout(sendTelemetry, sendTelemetryInterval);
	}
}

iotConnect();
setTimeout(sendTelemetry, sendTelemetryInterval);