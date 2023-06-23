import path = require('path');
import * as vscode from 'vscode';

export interface EditorChangeWatcher {
    onChange(editor: vscode.TextEditor): any;
    dispose(): any;
}

// Watches the active editors for any changes that would require re-rendering the decorations
export class EditorWatcher {
    renderFileTypes: string[];
    subscribers: EditorChangeWatcher[];
    changeWatchers: vscode.Disposable[];
    
    constructor(renderFileTypes: string[]) {
        this.renderFileTypes = renderFileTypes;
        this.subscribers = [];
        this.changeWatchers = [];
    }

    // Checks whether the given TextDocument requires rendering based on our configuration
    private isDocumentRelevant(document: vscode.TextDocument): boolean {
        for (let fileType of this.renderFileTypes) {
            let workspace = vscode.workspace.getWorkspaceFolder(document.uri);
            if (!workspace) {
                continue;
            }
            // Constructs a glob pattern relative to the root of the workspace containing the editor
            let glob = new vscode.RelativePattern(workspace.uri, fileType);
            if (vscode.languages.match({ pattern: glob }, document)) {
                return true;
            }
        }
        return false;
    }

    setup(): EditorWatcher {
        this.changeWatchers.push(vscode.window.onDidChangeActiveTextEditor(e => {
            // This notifies subscribers when the user switches the currently active editor (i.e. by switching tabs)
            console.log("Active text editor changed");
            if (e && this.isDocumentRelevant(e.document)) {
                this.subscribers.forEach(s => s.onChange(e));
            }
        }));

        this.changeWatchers.push(vscode.workspace.onDidChangeTextDocument(changedEditor => {
            console.log("TextDocument changed");
            // This notifies subscribers when the user makes a text change to the currently active editor
            let relevantEditors = vscode.window.visibleTextEditors.filter(
                visibleEditor => visibleEditor.document.uri === changedEditor.document.uri && this.isDocumentRelevant(changedEditor.document)
            );
            for (let editor of relevantEditors) {
                this.subscribers.forEach(s => s.onChange(editor));
            }
        }));

        return this;
    }

    // This function is called by the HighlightState tracker when there is a change to a relevant source file
    // It will only notify any subscribers if there is a visible editor relevant to them
    notifyOfExternalChange(relevantPaths: Set<string>) {
        for (let uri of relevantPaths) {
            vscode.window.visibleTextEditors.filter(editor => {
                // Filter down to visible text editors with the same URI path as one of the relevant URIs
                let editorPath = path.resolve(editor.document.uri.fsPath);
                return uri === editorPath;
            }).forEach(editor => {
                // Notify the subscribers of the change
                this.subscribers.forEach(s => s.onChange(editor));
            })
        }
    }

    addSubscriber(subscriber: EditorChangeWatcher) {
        this.subscribers.push(subscriber);
    }

    dispose() {
        this.subscribers.forEach(s => s.dispose());
        this.changeWatchers.forEach(s => s.dispose());

        this.subscribers = [];
        this.changeWatchers = [];
    }
}