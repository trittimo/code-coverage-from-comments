import * as vscode from  "vscode";
import { TextEditor } from "vscode";
import { EditorChangeWatcher, EditorWatcher } from "./editorWatcher";
import { HighlightState, CoverageRange } from "./highlightState";
import path = require("path");
import { FileChangeWatcher, FileWatcher } from "./fileWatcher";
import { ConfigChangeWatcher, ConfigManager } from "./configManager";


export class DecorationManager implements EditorChangeWatcher, FileChangeWatcher, ConfigChangeWatcher {
    disposables: vscode.Disposable[] = [];
    config: ConfigManager;
    styles: Map<string, vscode.TextEditorDecorationType> = new Map();
    editorWatcher: EditorWatcher;
    fileWatcher: FileWatcher;
    highlightState: HighlightState;

    constructor(config: ConfigManager, editorWatcher: EditorWatcher, fileWatcher: FileWatcher) {
        this.config = config;
        this.config.addSubscriber(this).notifyOne(this);
        this.fileWatcher = new FileWatcher(this.config).addSubscriber(this).notifyOne(this);
        this.editorWatcher = new EditorWatcher().addSubscriber(this).notifyOne(this);
        this.highlightState = new HighlightState();
        this.disposables.push(
            this.editorWatcher, this.fileWatcher
        );
    }

    onConfigChange(config: ConfigManager) {
        let colors = config.getSetting<any>("colors", {});
        for (let styleName in colors) {
            this.styles.set(styleName, vscode.window.createTextEditorDecorationType(colors[styleName] as vscode.DecorationRenderOptions));
        }

        // TODO
        // for each existing text editor decoration type, update the decoration to new style and reload decorations
    }

    onFileChange(uri: vscode.Uri) {
        
    }

    onFileDelete(uri: vscode.Uri) {
        throw new Error("Method not implemented.");
    }

    onEditorChange(editor: vscode.TextEditor) {
        throw new Error("Method not implemented.");
    }

    dispose() {
        this.disposables.forEach(s => s.dispose());
        this.disposables = [];
    }
}