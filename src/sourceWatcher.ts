import * as vscode from 'vscode';

export interface FileChangeWatcher {
    onChange(uri: vscode.Uri): any;
    onDelete(uri: vscode.Uri): any;
    dispose(): any;
}

// Watches the source code for comment changes that need to be reflected in the decoration
export class SourceWatcher {
    commentSourceFileTypes: string[];
    subscribers: FileChangeWatcher[];
    fileWatchers: vscode.FileSystemWatcher[];

    constructor(commentSourceFileTypes: string[]) {
        this.commentSourceFileTypes = commentSourceFileTypes;
        this.fileWatchers = [];
        this.subscribers = [];
    }

    setup(): SourceWatcher {
        if (!vscode.workspace.workspaceFolders) {
            return this;
        }

        for (let workspaceFolder of vscode.workspace.workspaceFolders) {
            for (let sourceFileType of this.commentSourceFileTypes) {
                let glob = new vscode.RelativePattern(workspaceFolder, sourceFileType);
                let fileWatcher = vscode.workspace.createFileSystemWatcher(glob);
                fileWatcher.onDidChange((uri => this.subscribers.forEach(s => s.onChange(uri))));
                fileWatcher.onDidCreate((uri => this.subscribers.forEach(s => s.onChange(uri))));
                fileWatcher.onDidDelete((uri => this.subscribers.forEach(s => s.onDelete(uri))));
                this.fileWatchers.push(fileWatcher);
            }
        }

        return this;
    }

    dispose() {
        this.fileWatchers.forEach(f => f.dispose());
        this.subscribers.forEach(s => s.dispose());

        this.fileWatchers = [];
        this.subscribers = [];
    }

    // Forcibly creates an onChange event for all relevant files for all subscribers
    // This should only be called on initialization
    forceNotify() {
        if (!vscode.workspace.workspaceFolders) {
            return false;
        }

        for (let workspaceFolder of vscode.workspace.workspaceFolders) {
            for (let sourceFileType of this.commentSourceFileTypes) {
                let glob = new vscode.RelativePattern(workspaceFolder, sourceFileType);

                vscode.workspace.findFiles(glob).then(uris => {
                    for (let uri of uris) {
                        this.subscribers.forEach(f => f.onChange(uri));
                    }
                });
            }
        }
    }

    addSubscriber(watcher: FileChangeWatcher) {
        this.subscribers.push(watcher);
    }
}