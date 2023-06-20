// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { readFileSync } from 'fs';
import * as vscode from 'vscode';

var highlightProviders: vscode.Disposable[] = [];

class HighlightProvider implements vscode.DocumentHighlightProvider {
	provideDocumentHighlights(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.DocumentHighlight[]> {
		console.log("Document requesting highlights");
		let range = new vscode.Range(0, 0, document.lineCount, 0);
		let result: vscode.DocumentHighlight[] = [];
		if (document.validateRange(range)) {
			let highlight: vscode.DocumentHighlight = new vscode.DocumentHighlight(range);
			result.push(highlight);
		} else {
			console.log("Range unnacceptable");
		}
		return result;
	}
}

function createConfigChangedWatcher(context: vscode.ExtensionContext) {
	return (uri: vscode.Uri) => {
		try {
			let config = JSON.parse(readFileSync(uri.fsPath, "utf8"));
			if (typeof config !== 'object' || config === null) {
				throw new Error();
			}

			highlightProviders.forEach(h => h.dispose());
			highlightProviders = [];

			let targets: string[] = config?.targets;
			if (targets !== null && targets.length > 0) {
				targets.forEach(globPattern => {
					if (vscode.workspace.workspaceFolders === null || vscode.workspace.workspaceFolders === undefined) {
						throw new Error("Workspace folders are null or undefined");
					}
					let docSelector: vscode.DocumentSelector = {
						pattern: new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], globPattern)
					};

					console.log(`Adding a highlight provider for documents matching '${globPattern}'`)
					
					let disposable = vscode.languages.registerDocumentHighlightProvider(docSelector, new HighlightProvider());
					highlightProviders.push(disposable);

					context.subscriptions.push(disposable);
				})
			}
		} catch {
			console.log("Unable to load extension due to failure parsing config");
			return;
		}

		console.log("Successfully loaded config");
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	var configChangedWatcher = createConfigChangedWatcher(context);

	if (vscode.workspace.workspaceFolders === null || vscode.workspace.workspaceFolders === undefined) {
		console.log("Cannot load extension because no folders are open");
		return;
	}

	var watcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], ".vscode/highlight-provider-config.json"));
	watcher.onDidChange(configChangedWatcher);
	watcher.onDidCreate(configChangedWatcher);

	vscode.window.onDidChangeActiveTextEditor(e => {
		console.log(e?.document.fileName);
		// let pattern = new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], ".vscode/highlight-provider-config.json");
		
	});


	vscode.workspace.findFiles(".vscode/highlight-provider-config.json").then(uris => {
		if (uris.length > 0) {
			configChangedWatcher(uris[0]);
		}
	});
	

	console.log('Congratulations, your extension "coverage-from-comments" is now active!');
}

// This method is called when your extension is deactivated
export function deactivate() {}
