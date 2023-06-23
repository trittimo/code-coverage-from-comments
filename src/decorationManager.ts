import * as vscode from  "vscode";
import { TextEditor } from "vscode";
import { EditorChangeWatcher } from "./editorWatcher";
import { HighlightState, CoverageRange } from "./highlightState";
import path = require("path");


const COVERED_DECORATION = vscode.window.createTextEditorDecorationType({
    backgroundColor: '#60822e',
    border: '1px solid #e2e2e2'
});

// This class receives notifications from the EditorWatcher and updates the visuals
export class DecorationManager implements EditorChangeWatcher {
    highlightState: HighlightState;
    constructor(highlightState: HighlightState) {
        this.highlightState = highlightState;
    }

    onChange(editor: TextEditor) {
        console.log("Change for " + editor.document.uri.fsPath);
        let uri = editor.document.uri;
        let decorations: vscode.DecorationOptions[] = [];
        let ranges = this.highlightState.targetToCoverageMap.get(path.resolve(uri.fsPath));
        if (!ranges) {
            // No decorations for this editor
            console.error("No decorations found for editor with path: " + path.resolve(uri.fsPath));
            return;
        }

        for (let rangeKey of ranges) {
            let coverageRange = this.highlightState.keyToCoverageMap.get(rangeKey);
            if (!coverageRange) {
                console.error("Could not lookup range with rangeKey: " + rangeKey);
                return;
            }
            decorations.push({ range: coverageRange.range });
        }

        editor.setDecorations(COVERED_DECORATION, decorations);
    }
    dispose() {
        // Nothing to dispose here
    }
}