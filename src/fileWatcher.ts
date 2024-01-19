import * as vscode from 'vscode';
import { ConfigChangeWatcher, ConfigManager } from './configManager';

export interface FileChangeWatcher {
    onFileChange(uri: vscode.Uri): any;
    onFileDelete(uri: vscode.Uri): any;
}

// Watches the source code for comment changes that need to be reflected in the decoration
export class FileWatcher implements ConfigChangeWatcher {
    subscribers: FileChangeWatcher[] = [];
    disposables: vscode.FileSystemWatcher[] = [];
    watchedFileTypes: string[] = [];

    config: ConfigManager;

    constructor(config: ConfigManager) {
        this.config = config;

        if (!vscode.workspace.workspaceFolders) {
            return;
        }

        this.config.addSubscriber(this);

        for (let workspaceFolder of vscode.workspace.workspaceFolders) {
            for (let watchFilePattern of this.watchedFileTypes) {
                let glob = new vscode.RelativePattern(workspaceFolder, watchFilePattern);
                let fileWatcher = vscode.workspace.createFileSystemWatcher(glob);
                fileWatcher.onDidChange((uri => this.subscribers.forEach(s => s.onFileChange(uri))));
                fileWatcher.onDidCreate((uri => this.subscribers.forEach(s => s.onFileChange(uri))));
                fileWatcher.onDidDelete((uri => this.subscribers.forEach(s => s.onFileDelete(uri))));
                this.disposables.push(fileWatcher);
            }
        }

        this.watchedFileTypes = this.config.getSetting("watchedFileTypes", []);
    }

    onConfigChange(config: ConfigManager) {
        this.watchedFileTypes = this.config.getSetting("watchedFileTypes", []);
        this.notifyAll();
    }


    dispose() {
        this.disposables.forEach(d => d.dispose());

        this.disposables = [];
        this.subscribers = [];
    }

    notifyAll(): FileWatcher {
        for (let subscriber of this.subscribers) {
            this.notifyOne(subscriber);
        }
        return this;
    }

    notifyOne(subscriber: FileChangeWatcher): FileWatcher {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return this;
        }

        for (let workspaceFolder of vscode.workspace.workspaceFolders) {
            for (let sourceFileType of this.watchedFileTypes) {
                let glob = new vscode.RelativePattern(workspaceFolder, sourceFileType);

                vscode.workspace.findFiles(glob).then(uris => {
                    for (let uri of uris) {
                        subscriber.onFileChange(uri);
                    }
                });
            }
        }
        return this;
    }

    addSubscriber(subscriber: FileChangeWatcher): FileWatcher {
        this.subscribers.push(subscriber);
        this.notifyOne(subscriber);
        return this;
    }
}