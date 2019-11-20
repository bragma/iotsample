const readline = require('readline');
const logger = require('pino')({
	base: null
});
const MqttWs = require('azure-iot-device-mqtt').MqttWs;
const IoT = require('azure-iot-device');
const NoRetry = require('azure-iot-common').NoRetry;
const ExpBackoff = require('azure-iot-common').ExponentialBackOffWithJitter;
const config = require('./config.json');
const iotClient = IoT.Client.fromConnectionString(config.HubConnectionString, MqttWs);

const sendTelemetryInterval = 20 * 1000;

const CLIENT_STATE = {
	DISCONNECTED: 'disconnected',
	CONNECTING: 'connecting',
	CONNECTED: 'connected'
}

let iotConnectionState = CLIENT_STATE.DISCONNECTED;
let iotCancelSend = null;

async function cleanUpAndReconnect() {
	cancelSendTelemetry();
	logger.info('cleanup');
	await iotConnect();
}

const pingHandler = async (request, response) => {
	logger.info(request.payload, 'ping received')
	try {
		await response.send(200, request.payload);
	} catch (err) {
		logger.error(err, 'device method failed');
	}
}

function onIoTConnection() {

	iotClient.setRetryPolicy(new NoRetry());
	iotConnectionState = CLIENT_STATE.CONNECTED;

	// Open succeeded, here we try to register device methods.
	// They are not registered at client creation because they
	// force a connection that cannot be tracked. There is no
	// way to know if it succeeds.
	//
	// Also there is no way to check if a method has already
	// been registered, so a try/catch is needed.
	//
	// NOTE: Internally device methods are associated to "method_"+name
	// string so they could be discovered via node events system
	// but it relies on internals so it should not be done.

	try {
		iotClient.onDeviceMethod('ping', pingHandler);
	} catch (err) {

		// This code just silences an expected error
		// Ugly, but the type for double registration is generic Error
		// Maybe a flag could be used to check if registration is needed
		if (!(err instanceof Error) || !err.message.includes('has already been registered'))
		{
			logger.error(err, 'onDeviceMethod failed');
		}
	}

	logger.info('connected');
}

async function iotConnect() {
	if (iotConnectionState === CLIENT_STATE.DISCONNECTED) {
		logger.info('connecting');

		iotConnectionState = CLIENT_STATE.CONNECTING;
		iotClient.setRetryPolicy(new ExpBackoff());

		try {
			await iotClient.open();
			onIoTConnection();
		} catch(err) {
			logger.error(err, 'open failed');
			iotConnectionState = CLIENT_STATE.DISCONNECTED;
			await cleanUpAndReconnect();
		}
	} else {
		logger.warn(`client state is ${iotConnectionState}`);
	}

}


iotClient.on('error', err => {
	logger.error(err, 'generic client failure');
});

iotClient.on('disconnect', async () => {
	logger.info('disconnected event');
	iotConnectionState = CLIENT_STATE.DISCONNECTED;
	await cleanUpAndReconnect();
});


// Sending telemetry still has problems.
// sendEvent never returns
async function sendTelemetry() {
	if (iotConnectionState === CLIENT_STATE.CONNECTED && !iotCancelSend) {

		logger.info('sending message');
		const msg = new IoT.Message(new Date().toString());

		try {
			const result = await Promise.race([iotClient.sendEvent(msg), new Promise(function(resolve, reject) {
				iotCancelSend = function() {
					reject(new Error('Promise canceled'))
				};
			})]);
			cancelSendTelemetry();
			logger.info(result.transportObj.messageId, 'message sent');
		} catch(err) {
			logger.error(err, 'send failed');
		}
	}
}

function cancelSendTelemetry() {
	if (iotCancelSend) {
		iotCancelSend();
		iotCancelSend = null;
	}
}

setInterval(sendTelemetry, sendTelemetryInterval);

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('keypress', (key, data) => {
	if (data.ctrl && data.name === 'c') {
		process.exit();
	} else if(data.name === 's') {
		sendTelemetry();
	} else if(data.name === 'c') {
		cleanUpAndReconnect();
	}
});

iotConnect();