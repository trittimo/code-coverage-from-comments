import * as vscode from 'vscode';
import { EditorWatcher } from './editorWatcher';
import { SourceWatcher } from './sourceWatcher';
import { CoverageRange, HighlightState } from './highlightState';
import { DecorationManager } from './decorationManager';
import { DocumentDetailProvider } from './documentDetailProvider';
import path = require('path');
import { isArray } from 'util';

class CoverageExtension {
    disposables: vscode.Disposable[];
    context: vscode.ExtensionContext;
    highlightState: HighlightState | undefined;

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
        this.highlightState = new HighlightState(editorWatcher);

        // This is the class responsible for actually decorating the UI
        let decorationManager = new DecorationManager(this.highlightState);

        sourceWatcher.addSubscriber(this.highlightState);
        editorWatcher.addSubscriber(decorationManager);

        let documentDetailProvider = new DocumentDetailProvider(config.get("renderFileTypes", []), this.highlightState);
        let selector = documentDetailProvider.getSelector();

        sourceWatcher.forceNotify();

        this.context.subscriptions.push(
            //vscode.languages.registerDocumentSymbolProvider(selector, documentDetailProvider),
            vscode.languages.registerDefinitionProvider(selector, documentDetailProvider));
    }

    
    summarizeLines(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) {
        let summary: any = {};
        for (let [_, coverageRange] of this.highlightState!.keyToCoverageMap) {
            let workspace = vscode.workspace.workspaceFolders![0];
            let workspacePath = path.resolve(workspace.uri.fsPath) + "\\";
            let targets = coverageRange.targetPath.replace(workspacePath, "").split("\\");
            let currTarget: any = summary;
            for (let i = 0; i < targets.length; i++) {
                let target = targets[i];
                if (!(target in currTarget)) {
                    if (i == targets.length - 1) {
                        currTarget[target] = [];
                    } else {
                        currTarget[target] = {};
                    }
                }
                currTarget = currTarget[target];
            }
            currTarget.push(coverageRange);
        }

        let result = summarize(summary, 0);

        copy(result);
        vscode.window.showInformationMessage("Copied summary to clipboard");
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

function summarize(target: any, indent: number): string {
    try {
        if (isArray(target)) {
            return "";
        }
        let result = "";
        for (let key in target) {
            result += " ".repeat(indent * 4);
            let summary = summarize(target[key], indent + 1);
            result += key + ": " + countRanges(target[key]) + "\n" + summary;
        }
        return result;
    } catch (ex) {
        console.log(ex);
        return "";
    }
}

function countRanges(target: any): number {
    let count = 0;
    if (isArray(target)) {
        for (let entry of target) {
            count += (entry as CoverageRange).range.end.line - (entry as CoverageRange).range.start.line + 1;
        }
        return count;
    }
    for (let key in target) {
        count += countRanges(target[key]);
    }
    return count;
}

export function copy(data: string) {
    require('child_process').spawn('clip').stdin.end(data);
}

export function copyLineRange(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) {
    if (editor.selections.length != 1) {
        vscode.window.showErrorMessage("You must have exactly one selection to use this command");
        return;
    }

    let filePath = path.resolve(editor.document.fileName);
    let workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    let fileName = "";
    if (workspaceFolder == undefined) {
        fileName = "{unnamedfile}";
    } else {
        let folderPath = path.resolve(workspaceFolder.uri.fsPath);
        fileName = filePath.replace(folderPath, "").replace(/\\/g, "/");
        if (fileName.startsWith("/")) {
            fileName = fileName.slice(1);
        }
    }

    let range = new vscode.Range(editor.selection.start, editor.selection.end);
    if (range.isSingleLine) {
        copy(fileName + ":L" + (range.start.line + 1));
    } else {
        copy(`${fileName}:L${range.start.line+1}-L${range.end.line+1}`);
    }

    vscode.window.showInformationMessage("Copied range to clipboard");
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

    let summarizeLines = (editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) => {
        return extension.summarizeLines(editor, edit, args);
    }

    context.subscriptions.push(vscode.commands.registerTextEditorCommand("coverage-from-comments.copyLineRange", copyLineRange));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand("coverage-from-comments.summarizeLines", summarizeLines));
    extension.reload();
}

// This method is called when your extension is deactivated
export function deactivate() {}


// Allow adding a list of line numbers e.g. L50-L52,L70-L75