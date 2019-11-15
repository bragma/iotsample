const logger = require('pino')({
	base: null
});
const MqttWs = require('azure-iot-device-mqtt').MqttWs;
const IoT = require('azure-iot-device');
const NoRetry = require('azure-iot-common').NoRetry;
const ExpBackoff = require('azure-iot-common').ExponentialBackOffWithJitter;
const config = require('./config.json');
const iotClient = IoT.Client.fromConnectionString(config.HubConnectionString, MqttWs);

const sendTelemetryInterval = 1000;

let iotConnected = false;

iotClient.on('error', err => {
	logger.error(err, 'generic client failure');
});

iotClient.onDeviceMethod('ping', async (request, response) => {
	try {
		await response.send(200, request.payload);
	} catch (err) {
		logger.error(err, 'device method failed');
	}
});

iotClient.on('disconnect', () => {

	iotConnected = false;

	logger.info('disconnected');

	// Try to riconnect
	iotConnect();
});

function onIoTConnection() {

	iotClient.setRetryPolicy(new NoRetry());

	iotConnected = true;

	logger.info('connected');
}


function iotConnect() {
	logger.info('connecting');

	iotClient.setRetryPolicy(new ExpBackoff());
	iotClient.open()
		.then(() => onIoTConnection())
		.catch(err => {
			logger.error(err, 'open failed')

			// Try to riconnect
			iotConnect();
		});
}


function sendTelemetry() {
	if (iotConnected) {
		logger.info('sending message');

		const msg = new IoT.Message(new Date().toString());
		return iotClient.sendEvent(msg)
			.then(result => {
				logger.info(result.transportObj.messageId, 'message sent');
			})
			.catch(err => {
				logger.error(err, 'send failed');
			})
			.finally(() => {
				setTimeout(sendTelemetry, sendTelemetryInterval);
			})
	} else {
		setTimeout(sendTelemetry, sendTelemetryInterval);
	}
}

iotConnect();
setTimeout(sendTelemetry, sendTelemetryInterval);