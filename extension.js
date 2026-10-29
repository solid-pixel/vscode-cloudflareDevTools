const vscode = require('vscode');
const { createCloudflareClient } = require('./src/cloudflareClient');
const { createController } = require('./src/controller');

let controller;

async function activate(context) {
	controller = createController(vscode, context, createCloudflareClient());
	context.subscriptions.push(controller);
	await controller.start();
}

function deactivate() {
	if (controller) {
		controller.dispose();
		controller = undefined;
	}
}

module.exports = { activate, deactivate };
