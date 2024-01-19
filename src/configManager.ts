import * as vscode from 'vscode';
import path = require("path");
import { Dirent, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';

const CONFIG_PATH = path.join(".vscode", "coverage_from_comments_config.json");

export interface ConfigChangeWatcher {
    onConfigChange(config: ConfigManager): any;
}

// Why use this instead of vscode's built-in config manager?
// Because it's annoying to have to commit that file if you want to share your settings with others across the project
export class ConfigManager {
    settings: any = {};
    disposables: vscode.Disposable[] = [];
    subscribers: ConfigChangeWatcher[] = [];

    constructor() {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return;
        }

        let workspaceFolder = vscode.workspace.workspaceFolders[0];

        let glob = new vscode.RelativePattern(workspaceFolder, CONFIG_PATH);
        let fileWatcher = vscode.workspace.createFileSystemWatcher(glob);
        fileWatcher.onDidChange(_ => this.notifyAll());
        fileWatcher.onDidCreate(_ => this.notifyAll());
        fileWatcher.onDidDelete(_ => this.notifyAll());
        this.disposables.push(fileWatcher);
        this.loadFile();
    }

    private loadFile() {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return;
        }

        let workspaceFolder = vscode.workspace.workspaceFolders[0];
        let fsPath = path.resolve(path.join(workspaceFolder.uri.fsPath, CONFIG_PATH));

        if (!existsSync(fsPath)) {
            this.settings = {};
            // Deletion would probably indicate user wants to use default settings
        } else {
            try {
                this.settings = JSON.parse(readFileSync(fsPath, {"encoding": "utf-8"}));
            } catch (ex) {
                // Don't change settings if we have a bad parse. User is probably temporarily modifying the file
                vscode.window.showErrorMessage("Code coverage from comments: bad config file (invalid JSON)");
                return;
            }
        }
    }

    notifyAll(): ConfigManager {
        for (let subscriber of this.subscribers) {
            this.notifyOne(subscriber);
        }
        return this;
    }

    notifyOne(subscriber: ConfigChangeWatcher): ConfigManager {
        subscriber.onConfigChange(this);
        return this;
    }

    addSubscriber(subscriber: ConfigChangeWatcher): ConfigManager {
        this.subscribers.push(subscriber);
        return this;
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.subscribers = [];
    }

    getSetting<T>(key: string, defaultValue: T): T {
        if (key in this.settings) {
            return this.settings[key] as T;
        } else {
            return defaultValue;
        }
    }
}