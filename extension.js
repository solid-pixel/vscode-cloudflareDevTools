const vscode = require( 'vscode' );
const DataProvider = require( './src/dataProvider.js' );

/**
 * @param {vscode.ExtensionContext} context
 */


const statusBar = vscode.window.createStatusBarItem( vscode.StatusBarAlignment.Right );
const config = vscode.workspace.getConfiguration( 'cloudflareDevTools' );
const https = require( 'https' );

let interval;

/* Config Variables */
let AUTH_KEY = config.api.key;
let AUTH_EMAIL = config.api.email;
let ZONE_ID = config.api.zoneID;
let purgeCacheAutomatically = config.cache.purgeAutomatically;
let checkStatusEnable = config.developmentModeStatus.enable;
let checkStatusInterval = config.developmentModeStatus.interval;
const host = 'api.cloudflare.com';
const port = '443';
let path = '/client/v4/zones/' + ZONE_ID;

// const colorOn = new vscode.ThemeColor("activityBarBadge.background");
const colorOff = new vscode.ThemeColor( 'statusBar.foreground' );

/* Output Log */
const outputCheck = vscode.window.createOutputChannel( 'Cloudflare DevTools | Status Check' );
const outputLogs = vscode.window.createOutputChannel( 'Cloudflare DevTools | Logs' );

function activate( context ) {

	/* Listen to config changes */
	configChanged();

	/* Commands */
	const devOn = vscode.commands.registerCommand( 'cloudflareDevTools.devOn',() => {

		devModeSwitch( 'on' );

	} );

	const devOff = vscode.commands.registerCommand( 'cloudflareDevTools.devOff', () => {

		devModeSwitch( 'off' );

	} );

	const purgeCache = vscode.commands.registerCommand( 'cloudflareDevTools.purgeCache', () => {

		purgeCacheFn();

	} );

	const commands = vscode.commands.registerCommand( 'cloudflareDevTools.commands', () => {

		vscode.commands.executeCommand( 'workbench.action.quickOpen', '>Cloudflare DevTools:' );

	} );

	/* Tree Data Provider */
	const myData = new DataProvider();
	const view = vscode.window.createTreeView( 'cloudflareDevTools-tree', {
		treeDataProvider: myData,
	} );

	/* Check Status */
	if ( AUTH_KEY && AUTH_EMAIL && ZONE_ID ) {

		if ( checkStatusEnable == true ) {

			checkStatus();

		}

	}

	/* Status Bar */
	statusBarFn();

	/* Subscriptions */
	context.subscriptions.push( devOn );
	context.subscriptions.push( devOff );
	context.subscriptions.push( purgeCache );
	context.subscriptions.push( commands );
	context.subscriptions.push( view );
	context.subscriptions.push( statusBar );

} // activate()

/* Listen for config changes */
function configChanged() {

	vscode.workspace.onDidChangeConfiguration( ( e ) => {

		if ( e.affectsConfiguration( 'cloudflareDevTools' ) ) {

			const config = vscode.workspace.getConfiguration( 'cloudflareDevTools' );

			AUTH_KEY = config.api.key;
			AUTH_EMAIL = config.api.email;
			ZONE_ID = config.api.zoneID;
			path = '/client/v4/zones/' + ZONE_ID;
			purgeCacheAutomatically = config.cache.purgeAutomatically;
			checkStatusEnable = config.developmentModeStatus.enable;
			checkStatusInterval = config.developmentModeStatus.interval;

			if ( checkStatusEnable == true ) {

				checkStatus();

			} else {

				clearInterval( interval );
				statusBarOff();
				outputCheck.replace( 'Periodic check has been disabled.' );

			}

			checkStatus();

		}


	} );

}


/* Status Bar Defaults */
function statusBarFn() {

	statusBar.text = '$(cloud)';
	statusBar.tooltip = 'Cloudflare DevTools';
	statusBar.command = 'cloudflareDevTools.commands';
	statusBar.show();

}


/* Status Bar On */
function statusBarOn( timeRemaining ) {

	const timeLeft = Math.floor( timeRemaining / 60 );

	// statusBar.color = colorOn;
	statusBar.tooltip = `Cloudflare Development Mode: ON (${ timeLeft } minutes left)`;
	statusBar.text = '$(cloud)';
	statusBar.backgroundColor = new vscode.ThemeColor( 'statusBarItem.warningBackground' );

}


/* Status Bar Off */
function statusBarOff() {

	statusBar.color = colorOff;
	statusBar.text = '$(cloud)';
	statusBar.tooltip = 'Cloudflare DevTools';
	statusBar.backgroundColor = null;

}


/* Status Bar Error */
function statusBarError() {

	statusBar.color = colorOff;
	statusBar.text = '$(cloud)';
	statusBar.tooltip = 'Couldn\'t ping the API, please check your settings.';
	statusBar.backgroundColor = new vscode.ThemeColor( 'statusBarItem.errorBackground' );

}


/* Development Mode */
function devModeStatusCallback( value, timeRemaining ) {

	if ( checkStatusEnable == true ) {

		if ( value == 'on' ) {

			statusBarOn( timeRemaining );

		} else {

			statusBarOff();

		}

	}


}


/* Switch Dev Mode ON/OFF */
function devModeSwitch( value ) {

	const postData = JSON.stringify( {
		'value': value
	} );

	const options = {
		host: host,
		port: port,
		path: path + '/settings/development_mode',
		method: 'PATCH',
		headers: {
			'X-Auth-Email': AUTH_EMAIL,
			'X-Auth-Key': AUTH_KEY,
			'Content-Type': 'application/json'
		}
	};

	const req = https.request( options, ( res ) => {

		// console.log(res.statusCode);
		const current = new Date();
		let body = '';

		res.on( 'data', ( chunk ) => {

			body += chunk;

		} );

		res.on( 'end', () => {

			body = JSON.parse( body );
			// console.log(body);

			if ( res.statusCode !== 200 ) {

				body.errors.forEach( e => {

					vscode.window.showErrorMessage( `${ e.message } (${ res.statusCode })` );
					outputLogs.appendLine( `[${ current.toLocaleTimeString() }] [Development Mode] Error: ${ e.message } (${ res.statusCode })` );

				} );

			} else {

				vscode.window.showInformationMessage( `Cloudflare Development Mode is now ${ value.toUpperCase() }.` );
				outputLogs.appendLine( `[${ current.toLocaleTimeString() }] Development Mode has been turned ${ body.result.value.toUpperCase() }` );
				devModeStatusCallback( body.result.value );

				if ( purgeCacheAutomatically == true ) {

					purgeCacheFn();

				}

			}

		} );

	} );

	req.on( 'error', ( e ) => {

		const current = new Date();

		vscode.window.showErrorMessage( e.message );
		outputLogs.appendLine( `[${ current.toLocaleTimeString() }] Error: ${ e.message }` );

	} );

	req.write( postData );

	req.end();

}


/* Check if Dev Mode is ON/OFF */
function devModeCheck() {

	const config = vscode.workspace.getConfiguration( 'cloudflareDevTools' );
	const https = require( 'https' );

	/* Config Variables */
	const AUTH_KEY = config.api.key;
	const AUTH_EMAIL = config.api.email;

	const options = {
		host: host,
		port: port,
		path: path + '/settings/development_mode',
		method: 'GET',
		headers: {
			'X-Auth-Email': AUTH_EMAIL,
			'X-Auth-Key': AUTH_KEY,
			'Content-Type': 'application/json'
		}
	};

	const req = https.request( options, ( res ) => {

		let body = '';
		const current = new Date();

		res.on( 'data', ( chunk ) => {

			body += chunk;

		} );

		res.on( 'end', () => {

			body = JSON.parse( body );

			if ( res.statusCode !== 200 ) {

				body.errors.forEach( e => {

					outputCheck.replace( `[${ current.toLocaleTimeString() }] [Check Development Mode status] Error: ${ e.message } (${ res.statusCode }) ` );

				} );

				statusBarError();

			} else {

				devModeStatusCallback( body.result.value, body.result.timeRemaining );
				outputCheck.replace( `[${ current.toLocaleTimeString() }] Periodic check: Development Mode is ${ body.result.value.toUpperCase() }` );

			}

		} );

	} );

	req.on( 'error', ( e ) => {

		const current = new Date();

		vscode.window.showErrorMessage( e.message );
		outputCheck.replace( `[${ current.toLocaleTimeString() }] Error: ${ e.message }` );

	} );

	req.end();

}


/* Purge Cache */
function purgeCacheFn() {

	const postData = JSON.stringify( {
		'purge_everything': true
	} );

	const options = {
		host: host,
		port: port,
		path: path + '/purge_cache',
		method: 'POST',
		headers: {
			'X-Auth-Email': AUTH_EMAIL,
			'X-Auth-Key': AUTH_KEY,
			'Content-Type': 'application/json'
		}
	};

	const req = https.request( options, ( res ) => {

		const current = new Date();
		let body = '';

		res.on( 'data', ( chunk ) => {

			body += chunk;

		} );

		res.on( 'end', () => {

			body = JSON.parse( body );

			if ( res.statusCode !== 200 ) {

				body.errors.forEach( e => {

					vscode.window.showErrorMessage( `Purge Cache: ${ e.message } (${ res.statusCode })` );
					outputLogs.appendLine( `[${ current.toLocaleTimeString() }] [Purge Cache] Error: ${ e.message } (${ res.statusCode }) ` );

				} );

			} else {

				vscode.window.showInformationMessage( 'Cloudflare Cache purged.' );
				outputLogs.appendLine( `[${ current.toLocaleTimeString() }] Cache purged.` );

			}

		} );

	} );

	req.on( 'error', ( e ) => {

		console.log( 'problem with request: ' + e.message );

	} );

	req.write( postData );

	req.end();

}


/* Check Development Mode Status */
function checkStatus() {

	if ( !interval ) {

		interval = setInterval( devModeCheck, checkStatusInterval * 1000 );

	} else {

		clearInterval( interval );
		interval = setInterval( devModeCheck, checkStatusInterval * 1000 );

	}

	devModeCheck();

}


function deactivate() {

	clearInterval( interval );

}

module.exports = {
	activate,
	deactivate
};