class DataProvider {
	constructor(vscode) {
		this.vscode = vscode;
		this.groups = [
			{ label: 'Development Mode', icon: 'code', actions: [
				['Turn On', 'devOn', 'check'], ['Turn Off', 'devOff', 'circle-slash']
			] },
			{ label: 'Cache', icon: 'database', actions: [['Purge', 'purgeCache', 'trash']] },
			{ label: 'Connection', icon: 'plug', actions: [
				['Test Connection', 'testConnection', 'debug-disconnect'],
				['Set API Token', 'configureToken', 'key'],
				['Remove API Token', 'removeToken', 'close']
			] }
		];
	}

	getTreeItem(element) {
		return element;
	}

	getChildren(element) {
		if (element) {
			return element.actions.map(([label, command, icon]) => {
				const item = new this.vscode.TreeItem(label);
				item.iconPath = new this.vscode.ThemeIcon(icon);
				item.command = { command: `cloudflareDevTools.${command}`, title: label };
				return item;
			});
		}
		return this.groups.map(group => ({
			...group,
			iconPath: new this.vscode.ThemeIcon(group.icon),
			collapsibleState: this.vscode.TreeItemCollapsibleState.Expanded
		}));
	}
}

module.exports = DataProvider;
