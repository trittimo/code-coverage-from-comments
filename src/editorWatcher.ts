import path = require('path');
import * as vscode from 'vscode';

export interface EditorChangeWatcher {
    onEditorChange(editor: vscode.TextEditor): any;
}

// Watches the active editors for any changes that would require re-rendering the decorations
export class EditorWatcher {
    subscribers: EditorChangeWatcher[] = [];
    disposables: vscode.Disposable[] = [];

    constructor() {
        // This notifies subscribers when the user switches the currently active editor (e.g. by switching tabs or opening a new tab)
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(e => {
            if (e) {
                this.subscribers.forEach(s => s.onEditorChange(e));
            }
        }));

        // This notifies subscribers when the user makes a text change to a currently visible editor
        this.disposables.push(vscode.workspace.onDidChangeTextDocument(changeEvent => {
            console.log("TextDocument changed");

            for (let subscriber of this.subscribers) {
                for (let editor of vscode.window.visibleTextEditors) {
                    if (editor.document.uri === changeEvent.document.uri) {
                        subscriber.onEditorChange(editor);
                    }
                }
            }
        }));
    }

    addSubscriber(subscriber: EditorChangeWatcher): EditorWatcher {
        this.subscribers.push(subscriber);
        return this;
    }

    notifyAll(): EditorWatcher {
        for (let subscriber of this.subscribers) {
            this.notifyOne(subscriber);
        }
        return this;
    }

    notifyOne(subscriber: EditorChangeWatcher): EditorWatcher {
        for (let editor of vscode.window.visibleTextEditors) {
            subscriber.onEditorChange(editor);
        }
        return this;
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.subscribers = [];
    }
}