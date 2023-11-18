import * as vscode from 'vscode';
import { EditorWatcher } from './editorWatcher';
import { SourceWatcher } from './sourceWatcher';
import { CoverageRange, HighlightState } from './highlightState';
import { DecorationManager } from './decorationManager';
import { DocumentDetailProvider } from './documentDetailProvider';
import path = require('path');
import { isArray } from 'util';
import { Dirent, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';

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

        let result = summarize(summary);

        const today = new Date();

        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        const year = today.getFullYear().toString();

        let date = `${month}-${day}-${year}`;

        const outputPath = resolvePathWithEnvVariable(`%UserProfile%/Flexware Innovation, Inc/Logan Aluminum - 204892_CM2 Level 2 Conversion/Project Management/Coverage Summaries/summary-${date}`);

        let uri = vscode.Uri.file(outputPath);
        vscode.window.showSaveDialog({
            defaultUri: uri,
            filters: {
                "CSV": ["csv"]
            },
            saveLabel: "Save Summary",
            title: "Save Coverage Summary"
        }).then(uri => {
            if (uri == undefined) return;
            writeFileSync(uri.fsPath, result, {encoding: "utf-8"});
        });

        // copy(result);
        // vscode.window.showInformationMessage("Copied summary to clipboard");
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

function resolvePathWithEnvVariable(inputPath: string): string {
    // Use a regular expression to find environment variables in the path
    const envVarRegex = /%([^%]+)%/g;

    // Replace each environment variable with its value
    const resolvedPath = inputPath.replace(envVarRegex, (_, envVar) => process.env[envVar] || '');

    // Use path.resolve to convert the resolved path to an absolute path
    const absolutePath = path.resolve(resolvedPath);

    return absolutePath;
}

function countRanges(ranges: Array<[number, number]>): number {
    // Sort the ranges based on their starting points
    ranges.sort((a, b) => a[0] - b[0]);

    let totalLength = 0;
    let currentRange: [number, number] | null = null;

    for (const range of ranges) {
        if (currentRange === null) {
            // If there is no current range, set the current range to the current range in the iteration
            currentRange = range;
        } else {
            // Check for overlap with the current range
            if (range[0] <= currentRange[1]) {
                // If overlap, update the end point of the current range if the current range extends further
                currentRange[1] = Math.max(currentRange[1], range[1]);
            } else {
                // If no overlap, add the length of the current range to the total length
                totalLength += currentRange[1] - currentRange[0] + 1;
                // Set the current range to the current range in the iteration
                currentRange = range;
            }
        }
    }

    // Add the length of the last remaining range (if any)
    if (currentRange !== null) {
        totalLength += currentRange[1] - currentRange[0] + 1;
    }

    return totalLength;
}

function countFile(path: string): number {
    if (!existsSync(path)) {
        return 0;
    }

    let fileContent = readFileSync(path, {encoding: "utf-8"});
    return fileContent.split("\n").length;
}

function isFortranFile(dirent: Dirent): boolean {
    if (!dirent.isFile()) return false;
    let name = dirent.name.toLowerCase();
    if (name.endsWith(".inc") || name.endsWith(".for") || name.endsWith(".pf")) return true;
    return false;
}

function getLineTotals(dir: string): Map<string, Map<string, number>> {
    if (vscode.workspace.rootPath === undefined) {
        throw new Error("No workspace open");
    }
    dir = path.join(vscode.workspace.rootPath, dir);
    if (!existsSync(dir)) {
        vscode.window.showErrorMessage("Unable to find root project directory");
        throw new Error("Unable to find root project directory");
    }
    let result = new Map<string, Map<string, number>>();

    let folders = readdirSync(dir, {encoding: "utf-8", recursive: false, withFileTypes: true});
    for (let folder of folders.filter(f => f.isDirectory())) {
        let summary = new Map<string, number>();
        result.set(folder.name, summary);
        let files = readdirSync(path.join(dir, folder.name), {encoding: "utf-8", recursive: true, withFileTypes: true});
        for (let file of files.filter(isFortranFile)) {
            summary.set(file.name, countFile(path.join(dir, folder.name, file.name)));
        }
    }

    return result;
}

function summarize(target: any): string {
    let completedProjects: Record<string, Array<string>> = {};
    if (vscode.workspace.rootPath != undefined) {
        let vscodePath = path.join(vscode.workspace.rootPath, ".vscode");
        let completedPath = path.join(vscodePath, "completed_projects.json");
        
        if (!existsSync(vscodePath)) {
            mkdirSync(vscodePath);
        }
    
    
        if (existsSync(completedPath)) {
            let content = readFileSync(completedPath, {"encoding": "utf-8"});
            try {
                completedProjects = JSON.parse(content) as Record<string, Array<string>>;
            } catch (ex) {
                vscode.window.showErrorMessage("Cannot parse .vscode/completed_projects.json - not valid JSON array");
            }
        }
    }


    let csvRows: Array<[string,string,string|number,string|number]> = [["directory","file","covered","total"]];
    for (let projectName in target) {
        let project = target[projectName];
        let lineTotals = getLineTotals(projectName);
        let fileCoverage = new Map<string, Map<string, number>>();
        let directoryCoverage = new Map<string, number>();
        for (let directoryName in project) {
            let directory = project[directoryName];
            let totalDirectoryCovered = 0;
            for (let fileName in directory) {
                let file = directory[fileName];
                let ranges: Array<[number, number]> = [];
                for (let coverageRange of file) {
                    ranges.push([coverageRange.range.start.line, coverageRange.range.end.line]);
                }
                let totalFileCovered = countRanges(ranges);
                if (!fileCoverage.has(directoryName)) {
                    fileCoverage.set(directoryName, new Map<string, number>());
                }
                fileCoverage.get(directoryName)!.set(fileName, totalFileCovered);
                totalDirectoryCovered += totalFileCovered;
            }
            directoryCoverage.set(directoryName, totalDirectoryCovered);
        }

        for (let directoryName of lineTotals.keys()) {
            let directory = lineTotals.get(directoryName)!;
            let totalDirectoryCovered = directoryCoverage.get(directoryName);
            totalDirectoryCovered = totalDirectoryCovered == undefined ? 0 : totalDirectoryCovered;

            if (directory.size == 0) {
                continue;
            }

            csvRows.push([directoryName, "", totalDirectoryCovered, 0]);
            let directoryTotal = 0;
            let dirRow = csvRows[csvRows.length - 1];

            for (let fileName of directory.keys()) {
                let totalLines = directory.get(fileName)!;
                directoryTotal += totalLines;
                let totalFileCovered = 0;
                if (fileCoverage.has(directoryName)) {
                    let directoryFiles = fileCoverage.get(directoryName)!;
                    if (directoryFiles.has(fileName)) {
                        totalFileCovered = directoryFiles.get(fileName)!;
                    }
                }
                csvRows.push(["", fileName, totalFileCovered, totalLines]);
            }

            dirRow[3] = directoryTotal;
            if (projectName in completedProjects && completedProjects[projectName].indexOf(directoryName) > -1) {
                dirRow[2] = directoryTotal;
            }
        }
    }

    
    let result = "";
    for (let row of csvRows) {
        result += row.join(",") + "\n";
    }
    return result.trimEnd();
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

export function markCompleted(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) {
    if (vscode.workspace.rootPath === undefined) {
        vscode.window.showErrorMessage("No workspace opened");
        return;
    }

    if (editor.document.uri.fsPath === undefined) {
        vscode.window.showErrorMessage("Current editor is not a file in the folder you would like to mark completed");
        return;
    }


    let vscodePath = path.join(vscode.workspace.rootPath, ".vscode");
    let completedPath = path.join(vscodePath, "completed_projects.json");

    let relFilePath = path.resolve(editor.document.uri.fsPath).replace(path.resolve(vscode.workspace.rootPath) + path.sep, "");
    let [projectName, folderName] = relFilePath.split(path.sep);
    
    
    if (!existsSync(vscodePath)) {
        mkdirSync(vscodePath);
    }

    let completed: Record<string, Array<string>> = {};

    if (existsSync(completedPath)) {
        let content = readFileSync(completedPath, {"encoding": "utf-8"});
        try {
            completed = JSON.parse(content) as Record<string, Array<string>>;
        } catch (ex) {
            vscode.window.showErrorMessage("Cannot parse .vscode/completed_projects.json - not valid JSON array");
        }
    }

    vscode.window.showInformationMessage(`Mark '${projectName}/${folderName}' as completed?`, "Yes", "No").then(choice => {
        if (choice == undefined || choice == "No") {
            return;
        }

        if (!(projectName in completed)) {
            completed[projectName] = [];
        }
        if (completed[projectName].indexOf(folderName) > -1) {
            vscode.window.showInformationMessage(`${folderName} already marked as completed`);
            return;
        }
        completed[projectName].push(folderName);
        writeFileSync(completedPath, JSON.stringify(completed, null, 4));
        vscode.window.showInformationMessage(`${projectName}/${folderName} marked as completed`);
    });

}

export function markUncompleted(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: any[]) {
    if (vscode.workspace.rootPath === undefined) {
        vscode.window.showErrorMessage("No workspace opened");
        return;
    }

    if (!existsSync(".vscode")) {
        return;
    }

    vscode.window.showErrorMessage("Not yet implemented - edit .vscode/completed_projects.json");

    // TODO
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
    context.subscriptions.push(vscode.commands.registerTextEditorCommand("coverage-from-comments.markCompleted", markCompleted));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand("coverage-from-comments.markUncompleted", markUncompleted));

    extension.reload();
}

// This method is called when your extension is deactivated
export function deactivate() {}


// Allow adding a list of line numbers e.g. L50-L52,L70-L75