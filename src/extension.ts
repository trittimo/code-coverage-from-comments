import * as vscode from 'vscode';
import { EditorWatcher } from './editorWatcher';
import { SourceWatcher } from './sourceWatcher';
import { HighlightState } from './highlightState';
import { DecorationManager } from './decorationManager';

class CoverageExtension {
    disposables: vscode.Disposable[];
    context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.disposables = [];
    }

    reload() {
        this.dispose();
        
        let config = vscode.workspace.getConfiguration("coverage-from-comments");

        // The editor watcher is responsible for checking whether an active editor relevant to rendering has changed, and if so notify subscribers of that change
        // The subscriber(s) of this are responsible for rendering highlight ranges inside of a text editor based on the state provided by sourceWatcher states
        let editorWatcher = new EditorWatcher(config.get("renderFileTypes", [])).setup();
        this.disposables.push(editorWatcher);

        // The source watcher is responsible for checking whether a relevant source file has changed, and if so notify subscribers of that chnage
        // The subscriber(s) of this are responsible for maintaining the highlight range states
        let sourceWatcher = new SourceWatcher(config.get("commentSourceFileTypes", [])).setup();
        this.disposables.push(sourceWatcher);

        // This is the class responsible for reading file contents and maintaining the state of comment coverage
        // It will also tell the EditorWatcher when a change is made to an external file
        let highlightState = new HighlightState(editorWatcher);

        // This is the class responsible for actually decorating the UI
        let decorationManager = new DecorationManager(highlightState);

        sourceWatcher.addSubscriber(highlightState);
        editorWatcher.addSubscriber(decorationManager);

        sourceWatcher.forceNotify();
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    let extension = new CoverageExtension(context);
    vscode.workspace.onDidChangeConfiguration(c => {
        if (c.affectsConfiguration("coverage-from-comments")) {
            extension.reload();
        }
    });
    extension.reload();
}

// This method is called when your extension is deactivated
export function deactivate() {}


// Allow adding a list of line numbers e.g. L50-L52,L70-L75