import * as vscode from  "vscode";
import { FileChangeWatcher } from "./sourceWatcher";
import { EditorWatcher } from "./editorWatcher";
import { readFile } from "fs";
import path = require("path");

const COMMENT_REGEXES = [
    /(\S+):L(\d+)\-L(\d+)/, // Matches {any-non-whitespace}:L{digits}-L{digits}
    /(\S+):L(\d+)/ // Mathches {any-non-whitespace}:L{digits}
]

export class CoverageRange {
    targetPath: string;
    sourcePath: string;
    range: vscode.Range;
    key: string;

    constructor(targetPath: string, sourcePath: string, range: vscode.Range) {
        this.targetPath = targetPath;
        this.sourcePath = sourcePath;
        this.range = range;
        // This is used as an index for the Set containing these since we can't use objects
        this.key = (targetPath + sourcePath + range.start.line + range.end.line);
    }
}

function *setNegation<T>(setA: Set<T>, setB: Set<T>) {
    let A = new Set<T>(setA);
    let B = new Set<T>(setB);
    for (let b of B.values()) {
        if (!setA.delete(b)) {
            yield b;
        }
    }

    for (let a of setA.values()) {
        yield a;
    }
}

export class HighlightState implements FileChangeWatcher {
    editorWatcher: EditorWatcher;
    // Maps a targetPath to the list of applicable CoverageRange object keys
    // Why not a set of CoverageRange? Because javascript hasn't figured out how to do hashCodes for objects yet
    // Which is just incredible
    // These are what are used to actually render match ranges upon request by the EditorWatcher subscriber
    keyToCoverageMap: Map<string, CoverageRange>;
    targetToCoverageMap: Map<string, Set<string>>;

    // Maps a sourcePath to the list of CoverageRanges it 'owns'
    // We use this when a file is deleted or modified to remove the matches created by it
    sourceToCoverageMap: Map<string, Set<string>>;

    constructor(editorWatcher: EditorWatcher) {
        this.editorWatcher = editorWatcher;
        this.keyToCoverageMap = new Map();
        this.targetToCoverageMap = new Map();
        this.sourceToCoverageMap = new Map();
    }

    getCoverageRangeFromMatch(matches: RegExpMatchArray, basePath: string, sourcePath: string): CoverageRange | null {
        try {
            let targetFile = matches[1];
            
            let targetPath = path.join(basePath, targetFile);
            let l0 = Number.parseInt(matches[2]);
            let range: vscode.Range;
            if (matches.length >= 4) { // Matches file:L1-L2
                let l1 = Number.parseInt(matches[3]);
                // Assumes comments are 1-indexed, hence subtracting one to match the expected 0-index vscode.Range object
                // Presumably the lines we care about aren't more than 999 characters long
                // vscode will truncate when actually rendering the background color
                range = new vscode.Range(l0 - 1, 0, l1 - 1, 999);
            } else { // Matches file:L1
                range = new vscode.Range(l0 - 1, 0, l0 - 1, 999);
            }
            return new CoverageRange(targetPath, sourcePath, range);
        } catch {
            console.error(`Encountered error trying to match line`);
        }
        return null;
    }

    onChange(uri: vscode.Uri) {
        // Read the changed file and identify all the comments relevant to us
        // If there are any comments in the coverage format, construct a list of URIs pointing to those files and notify the EditorWatcher

        if (!vscode.workspace.workspaceFolders) {
            throw new Error("No workspace");
        }

        // Resolve the base path of the workspace containing the file
        // We will use this to construct a path back to the file in the coverage comment relative to that base path
        // For example:
        //     1. The workspace folder is c:/users/myuser/project
        //     2. There is a file at the path c:/users/myuser/project/src/SomeFile.cs
        //     3. There is a comment in SomeFile.cs that looks like '// subfolder/myprocedure.for:L81-L92'
        //     4. We will discover this comment and try to create a coverage region at c:/users/myuser/project/subfolder/myprocedure.for, lines 81 through 92
        let workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        let basePath = workspaceFolder ? path.resolve(workspaceFolder.uri.fsPath) : "";
        if (basePath.length === 0) {
            throw new Error("Unable to resolve workspace folder path");
        }
        let sourcePath = path.resolve(uri.fsPath);

        // Read the file we were notified has changed and see if it contains any matches
        readFile(sourcePath, "utf-8", (err, data) => {
            if (err) {
                // Something went wrong reading the file, barf it back up to the caller
                throw err;
            }
            let lines = data.split("\n");

            // Iterate over every line in the file and if there is a match, add it to our state
            let currMatches = new Set<string>();
            let changedFiles = new Set<string>();
            for (let i = 0; i < lines.length; i++) {
                for (let regex of COMMENT_REGEXES) {
                    let matches = lines[i].match(regex);
                    if (!matches) {
                        continue;
                    }

                    let coverageRange = this.getCoverageRangeFromMatch(matches, basePath, sourcePath);
                    if (coverageRange) {
                        console.log("Found coverage range mapping from " + coverageRange.sourcePath + " to " + coverageRange.targetPath);
                        let set = this.targetToCoverageMap.get(coverageRange.targetPath);
                        if (!set) {
                            set = new Set<string>();
                            this.targetToCoverageMap.set(coverageRange.targetPath, set);
                        }
                        set.add(coverageRange.key);
                        this.keyToCoverageMap.set(coverageRange.key, coverageRange);
                        currMatches.add(coverageRange.key);
                        changedFiles.add(coverageRange.targetPath);
                        break;
                    }
                }
            }

            // If there is an existing array of coverage ranges sourced from this file,
            // make sure we remove any that aren't present anymore
            let prevMatches = this.sourceToCoverageMap.get(sourcePath);
            if (prevMatches) {
                let missing = Array.from(setNegation(prevMatches, currMatches));
                for (let key of missing) {
                    let coverage = this.keyToCoverageMap.get(key);
                    if (!coverage) {
                        // This shouldn't be possible
                        throw new Error("Missing coverage item");
                    }
                    this.targetToCoverageMap.get(coverage.targetPath)?.delete(coverage.key);
                    this.keyToCoverageMap.delete(key); // We could probably leave it in-place, but no reason to let this map grow without bounds
                }
            }

            // Notify the editor watcher that we have had an external change
            this.editorWatcher.notifyOfExternalChange(changedFiles);
            this.sourceToCoverageMap.set(sourcePath, currMatches);
        });
    }

    onDelete(uri: vscode.Uri) {
        // Check which file has been changed and remove all the coverage comments which were sourced from them
        let sourcePath = path.resolve(uri.fsPath);
        let sourceSet = this.sourceToCoverageMap.get(sourcePath);
        if (sourceSet) {
            for (let matchKey of sourceSet) {
                let coverage = this.keyToCoverageMap.get(matchKey);
                if (!coverage) continue;
                let targetSet = this.targetToCoverageMap.get(coverage.targetPath);
                if (!targetSet) continue;
                targetSet.delete(coverage.key);
            }
        }
    }

    dispose() {
        // Nothing to do here
    }

}