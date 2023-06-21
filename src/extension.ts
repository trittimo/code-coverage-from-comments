// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { readFile } from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';

// Match MyFileName.for:L80-L180
const COMMENT_REGEXES = [
    /(\S+):L(\d+)\-L(\d+)/,
    /(\S+):L(\d+)/
]

const COVERED_DECORATION = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'green',
    border: '2px solid white'
});

class CoveredRange extends vscode.Range {
    source: string;

    constructor(source: string, startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
        super(startLine, startCharacter, endLine, endCharacter);
        this.source = source;
    }
}

class CommentCache {
    coverageRanges: Map<string, Set<CoveredRange>>;
    decorator: CoverageDecorator;

    constructor(decorator: CoverageDecorator) {
        this.coverageRanges = new Map();
        this.decorator = decorator;
    }

    addCoverageRange(matches: RegExpMatchArray | null, line: number, file: vscode.Uri, basePath: string) {
        try {
            if (matches) {
                let uri = vscode.Uri.joinPath(vscode.Uri.file(basePath), matches[1]);
                let uriPath = path.resolve(uri.fsPath);
                console.log("Adding path: " + matches[1]);
                if (this.coverageRanges.get(uriPath) === undefined) {
                    this.coverageRanges.set(uriPath, new Set<CoveredRange>());
                }
                let l0 = Number.parseInt(matches[2]);
                if (matches.length >= 4) {
                    let l1 = Number.parseInt(matches[3]);
                    console.log(`\tFound match on line ${line} for L${l0}-L${l1}`);
                    this.coverageRanges.get(uriPath)?.add(new CoveredRange(uriPath, l0 - 1, 0, l1 - 1, 999));
                } else {
                    console.log(`\tFound match on line ${line} for L${l0}-L${l0}`);
                    this.coverageRanges.get(uriPath)?.add(new CoveredRange(uriPath, l0 - 1, 0, l0 - 1, 999));
                }
                return true;
            }
        } catch {
            console.error(`Encountered error trying to match line '${line}' in file '${file.fsPath}'`);
        }
        return false;
    }

    // This seems like a complicated function, but it's not that bad in actuality
    // All it does is:
    // 1. Read the file passed as a URI
    // 2. Split it up into separate lines
    // 3. Check if any lines match the expected comment format
    // 4. If they do, add the match as a range to the coverageRanges Map
    onSourceFileChanged(uri: vscode.Uri) {
        console.log(`File changed: ${uri.fsPath}`);
        let basePath = uri.path.split("/").slice(0, -1).join("/");
        readFile(uri.fsPath, "utf-8", (err, data) => {
            let lines = data.split("\n");

            for (let i = 0; i < lines.length; i++) {
                for (let regex of COMMENT_REGEXES) {
                    let matches = lines[i].match(regex);
                    if (this.addCoverageRange(matches, i, uri, basePath)) {
                        break;
                    }
                }
            }
        });
        
        // This forcibly applies a decoration update to any editors with the given uri that are visible to the user
        vscode.window.visibleTextEditors.filter(e => e.document.uri == uri).map(this.decorator.decorate);
    }

    onSourceFileRemoved(uri: vscode.Uri) {
        // There's a better way to do this if we have a 3 layer map from source URI -> target URI -> Set<CoveredRange>
        // However, this doesn't need to be done often so we can sacrifice the performance for the sake of ease of use
        for (let ranges of this.coverageRanges.values()) {
            let toDelete = [];
            for (let range of ranges.values()) {
                if (range.source == path.resolve(uri.fsPath)) {
                    toDelete.push(range);
                }
            }
            toDelete.forEach(r => ranges.delete(r));
        }
    }

    clear() {
        this.coverageRanges.clear();
    }

    needsDecoration(uri: vscode.Uri) {
        let ranges = this.coverageRanges.get(uri.fsPath);
        if (ranges === undefined) {
            return false;
        }
        return ranges.size > 0;
    }

    getDecorations(uri: vscode.Uri) {
        console.log("Decorations for " + path.resolve(uri.fsPath));
        let decorations: vscode.DecorationOptions[] = [];
        let ranges = this.coverageRanges.get(path.resolve(uri.fsPath));
        if (ranges === undefined) {
            // Shouldn't be possible since we check the size in needsDecoration
            return [];
        }
        for (let range of ranges) {
            console.log(range.start.line);
            decorations.push({range});
        }

        return decorations;
    }
}

class CoverageDecorator {
    context: vscode.ExtensionContext;
    fileWatchers: Map<string, vscode.FileSystemWatcher[]>;
    renderFileTypes: string[];
    commentCache: CommentCache;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.fileWatchers = new Map();
        this.renderFileTypes = [];
        this.commentCache = new CommentCache(this);
    }

    setFileTypes(sourceFileTypes: string[], renderFileTypes: string[]) {
        if (vscode.workspace.workspaceFolders === undefined) {
            console.error("Unable to set file types for extension because there are no folders loaded in the workspace");
            return;
        }

        for (let watchers of this.fileWatchers.values()) {
            watchers.forEach(w => w.dispose());
        }

        this.fileWatchers.clear();
        this.commentCache.clear();

        for (let workspaceFolder of vscode.workspace.workspaceFolders) {
            let watchers: vscode.FileSystemWatcher[] = [];
            for (let sourceFileType of sourceFileTypes) {
                var glob = new vscode.RelativePattern(workspaceFolder, sourceFileType);
                var watcher = vscode.workspace.createFileSystemWatcher(glob);
                watcher.onDidChange(this.commentCache.onSourceFileChanged);
                watcher.onDidCreate(this.commentCache.onSourceFileChanged);
                watcher.onDidDelete(this.commentCache.onSourceFileRemoved);

                // Initialize our comment cache for the first time
                vscode.workspace.findFiles(glob).then(uris => {
                    for (let uri of uris) {
                        this.commentCache.onSourceFileChanged(uri);
                    }
                });
                watchers.push(watcher);
            }
            this.fileWatchers.set(workspaceFolder.name, watchers);
        }
        
        this.renderFileTypes = renderFileTypes;
    }

    decorate(editor: vscode.TextEditor) {
        let uri = editor.document.uri;
        if (!this.commentCache.needsDecoration(uri)) {
            console.log(`Ignoring decoration for editor: ${editor.document.uri.fsPath}`);
            for (let uri of this.commentCache.coverageRanges.keys()) {
                console.log(`\tPossible uris: ${uri}`);
            }
            return;
        }
        console.log(`Found editor to decorate: ${editor.document.uri.fsPath}`);

        let decorations = this.commentCache.getDecorations(uri);
        editor.setDecorations(COVERED_DECORATION, decorations);
    }
}

let disposables: vscode.Disposable[] = [];

function setupExtension(context: vscode.ExtensionContext) {
    disposables.forEach(d => d.dispose());
    disposables = [];

    let config = vscode.workspace.getConfiguration("coverage-from-comments");
    let sourceFileTypes: string[] = config.get("commentSourceFileTypes", []);
    let renderFileTypes: string[] = config.get("renderFileTypes", []);

    let decorator = new CoverageDecorator(context);
    decorator.setFileTypes(sourceFileTypes, renderFileTypes);
    disposables.push(vscode.window.onDidChangeActiveTextEditor(e => {
        if (e && e.document.uri) {
            decorator.decorate(e);
        }
    }));
    disposables.push(vscode.workspace.onDidChangeTextDocument(e => {
        let openEditor = vscode.window.visibleTextEditors.filter(
            editor => editor.document.uri === e.document.uri
        )[0];
        decorator.decorate(openEditor);
    }));

    // vscode.window.visibleTextEditors.filter(e => e && e.document.uri).forEach(decorator.decorate);

    console.log('Reloaded extension');
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    vscode.workspace.onDidChangeConfiguration(c => {
        if (c.affectsConfiguration("coverage-from-comments")) {
            setupExtension(context);
        }
    });
    setupExtension(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
