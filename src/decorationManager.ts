import * as vscode from  "vscode";
import { TextEditor } from "vscode";
import { EditorChangeWatcher } from "./editorWatcher";
import { HighlightState, CoverageRange } from "./highlightState";
import path = require("path");


const DECORATION_TYPES: Map<string, vscode.TextEditorDecorationType> = new Map();
DECORATION_TYPES.set("wip", vscode.window.createTextEditorDecorationType({
        backgroundColor: '#fc8803',
        border: '1px solid #e2e2e2'
}));

DECORATION_TYPES.set("ignored", vscode.window.createTextEditorDecorationType({
    backgroundColor: '#000000',
    border: '1px solid #e2e2e2'
}));

DECORATION_TYPES.set("default", vscode.window.createTextEditorDecorationType({
    backgroundColor: '#60822e',
    border: '1px solid #e2e2e2'
}));

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
        let decorationsMap: Map<string, vscode.DecorationOptions[]> = new Map();
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
            if (DECORATION_TYPES.has(coverageRange.kind)) {
                if (!decorationsMap.get(coverageRange.kind)) {
                    decorationsMap.set(coverageRange.kind, []);
                }
                decorationsMap.get(coverageRange.kind)?.push({ range: coverageRange.range });
            } else {
                if (!decorationsMap.get("default")) {
                    decorationsMap.set("default", []);
                }
                decorationsMap.get("default")?.push({ range: coverageRange.range });
            }
        }

        for (let decorationType of decorationsMap.keys()) {
            let decoration = DECORATION_TYPES.get(decorationType);
            if (!decoration) {
                continue;
            }
            let range = decorationsMap.get(decorationType);
            if (!range) {
                continue;
            }
            editor.setDecorations(decoration, range);
        }
    }
    dispose() {
        // Nothing to dispose here
    }
}