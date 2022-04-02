const vscode = require("vscode");
// const cf = require('./cloudflare');

class DataProvider {

	constructor() {

		this.CFFolders = [
			{
				CFFolder: "Development Mode",
				icon: "code",
				
				CFAction: [{ 
					name: "Turn On", 
					command: "cloudflareDevTools.devOn",
					icon: "check"
				},{
					name: "Turn Off",
					command: "cloudflareDevTools.devOff",
					icon: "circle-slash"
				}],
			},
			{
				CFFolder: "Cache",
				icon: "database",
				
				CFAction: [{ 
					name: "Purge", 
					command: "cloudflareDevTools.purgeCache",
					icon: "trash"
				}],
			}
		];
		this.CFTreeItems = this.convertCFFoldersToTreeFolders();
		
	}

	getTreeItem(element) {
		return element;
	}

	getChildren(element) {
		if (element) {
			return element.getCFActionDetails();
		} else {
			return this.CFTreeItems;
		}
	}

	convertCFFoldersToTreeFolders() {
		let folders = [];
		this.CFFolders.forEach((element) => {
			let folder = new cloudflareTreeItem(element, vscode.TreeItemCollapsibleState.Expanded);
			// folder.iconPath = new vscode.ThemeIcon(element.icon, cf.colorOn);
			folder.iconPath = new vscode.ThemeIcon(element.icon);
			folders.push(
				folder
			);
		});
		return folders;
	}
}
class cloudflareTreeItem {

	constructor(CFActionsTree, collapsibleState) {
		this.CFActionsTree = CFActionsTree;
		this.label = CFActionsTree.CFFolder;
		this.collapsibleState = collapsibleState;
		// this.CFActionDetails = [];
		this.convertCFActionToTreeItems();
	}

	convertCFActionToTreeItems() {

			let actions = [];
			this.CFActionsTree.CFAction.forEach((element) => {
				let action = new vscode.TreeItem(
					element.name
				)
				action.command = {
					command: element.command,
				}
				action.iconPath = new vscode.ThemeIcon(element.icon);
				actions.push(
					action
				);
			});
			this.CFActionDetails = actions;
		
	}

	getCFActionDetails() {
		return this.CFActionDetails;
	}

}

module.exports = DataProvider;