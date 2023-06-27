import * as vscode from 'vscode';
import { CoverageRange, HighlightState } from './highlightState';
import path = require('path');

export class DocumentDetailProvider implements vscode.DocumentSymbolProvider, vscode.DefinitionProvider {
    renderFileTypes: string[];
    highlightState: HighlightState;
    constructor(renderFileTypes: string[], highlightState: HighlightState) {
        this.renderFileTypes = renderFileTypes;
        this.highlightState = highlightState;
    }

    private getCoverageLinks(document: vscode.TextDocument, position: vscode.Position | undefined): CoverageRange[] {
        console.log("Providing coverage links for: " + document.uri.fsPath);
        let results: CoverageRange[] = [];
        let documentPath = path.resolve(document.uri.fsPath);
        let targets = this.highlightState.targetToCoverageMap.get(documentPath);
        if (!targets) {
            console.log("\tNo need to provide coverage links for: " + document.uri.fsPath);
            return results;
        }

        for (let targetKey of targets) {
            let target = this.highlightState.keyToCoverageMap.get(targetKey);
            if (!target) {
                console.error("Missing target key: " + targetKey);
                continue;
            }
            if (!position) {
                results.push(target);
            } else if (target.range.contains(position)) {
                results.push(target);
            }
        }
        return results;
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.DefinitionLink[] {
        let result = this
            .getCoverageLinks(document, position)
            .map(target => {
                let targetRange = new vscode.Range(target.sourceLine - 1, 0, target.sourceLine + 3, 99);
                let link: vscode.DefinitionLink = {
                    originSelectionRange: target.range,
                    targetUri: vscode.Uri.file(target.sourcePath),
                    targetRange: targetRange,
                    targetSelectionRange: targetRange
                };

                return link;
        });

        console.log("\tProviding " + result.length + " definitions");
        return result;
    }


    // async provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentLink[]> {
    //     console.log("Providing document links for: " + document.uri.fsPath);
    //     let results: vscode.DocumentLink[] = [];
    //     let documentPath = path.resolve(document.uri.fsPath);
    //     let targets = this.highlightState.targetToCoverageMap.get(documentPath);
    //     if (!targets) {
    //         console.log("\tNo need to provide document links for: " + document.uri.fsPath);
    //         return results;
    //     }
    //     for (let targetKey of targets) {
    //         if (token.isCancellationRequested) {
    //             console.log("\tCancellation requested");
    //             return results;
    //         }
    //         let target = this.highlightState.keyToCoverageMap.get(targetKey);
    //         if (!target) {
    //             console.error("Missing target key: " + targetKey);
    //             continue;
    //         }
    //         let workspaceFolder = vscode.workspace.workspaceFolders;
    //         if (!workspaceFolder) {
    //             console.error("No workspace folder selected");
    //             return [];
    //         }
    //         let sourceUri = vscode.Uri.file(target.sourcePath);

    //         results.push({range: target.range, target: sourceUri, tooltip: "Navigate to source"});
    //     }
    //     console.log(`\tProvided ${results.length} DocumentLinks`);
    //     return results;
    // }

    provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentSymbol[] {
        console.log("Providing document symbols for: " + document.uri.fsPath);
        let results: vscode.DocumentSymbol[] = [];
        let documentPath = path.resolve(document.uri.fsPath);
        let targets = this.highlightState.targetToCoverageMap.get(documentPath);
        if (!targets) {
            console.log("\tNo need to provide document symbols for: " + document.uri.fsPath);
            return results;
        }

        for (let targetKey of targets) {
            if (token.isCancellationRequested) {
                console.log("\tCancellation requested");
                return results;
            }
            let target = this.highlightState.keyToCoverageMap.get(targetKey);
            if (!target) {
                console.error("Missing target key: " + targetKey);
                continue;
            }
            results.push(new vscode.DocumentSymbol(target.comment, target.sourcePath, vscode.SymbolKind.File, target.range, target.range));
        }
        console.log(`\tProvided ${results.length} DocumentSymbols`);
        return results;
    }

    getSelector(): ReadonlyArray<vscode.DocumentFilter> {
        console.log("Getting selectors");
        let workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        return this.renderFileTypes.map(pattern => {
            if (!workspaceFolders) {
                // Not possible to throw this error
                throw new Error("Missing workspace folder");
            }
            return {scheme: "file", pattern: new vscode.RelativePattern(workspaceFolders[0].uri, pattern)}
        });
    }

    dispose() {

    }
}