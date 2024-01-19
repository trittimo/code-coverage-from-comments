import * as vscode from  "vscode";
import { FileChangeWatcher } from "./fileWatcher";
import { EditorWatcher } from "./editorWatcher";
import { readFile } from "fs";
import path = require("path");


class RegexHandler {
    checkForRanges(line: string, basePath: string, sourcePath: string, lineNumber: number): CoverageRange[] {
        let results: CoverageRange[] = [];
        try {
            let matchResults = line.match(/(\S+):(L[\d]+.*)/);
            if (!matchResults) {
                return results;
            }

            let targetFile = matchResults[1];
            let targetPath = path.join(basePath, targetFile);
            let lineRanges = matchResults[2];
            // console.log(lineRanges);
            let kindMatch = line.trimEnd().match(/\(([^\)]+)\)$/);
            let kind = "default";
            if (kindMatch) {
                kind = kindMatch[1].toLowerCase();
            }
            for (let lineRange of lineRanges.split(",")) {
                let rangeMatch = lineRange.match(/L(\d+)\-L(\d+)/);
                if (rangeMatch) {
                    let l0 = Number.parseInt(rangeMatch[1]) - 1;
                    let l1 = Number.parseInt(rangeMatch[2]) - 1;
                    let range = new vscode.Range(l0, 0, l1, 999);
                    results.push(new CoverageRange(targetPath, sourcePath, range, kind, line.trim(), lineNumber));
                    // console.log("\t" + rangeMatch[1] + "," + rangeMatch[2]);
                    continue;
                }
                rangeMatch = lineRange.match(/L(\d+)/);
                if (rangeMatch) {
                    let l0 = Number.parseInt(rangeMatch[1]) - 1;
                    let range = new vscode.Range(l0, 0, l0, 999);
                    results.push(new CoverageRange(targetPath, sourcePath, range, kind, line.trim(), lineNumber));
                }
            }
        } catch {
            console.error("Encountered exception parsing line in " + sourcePath);
        }
        return results;
    }
}

export class CoverageRange {
    targetPath: string;
    sourcePath: string;
    range: vscode.Range;
    key: string;
    comment: string;
    kind: string;
    sourceLine: number;

    constructor(targetPath: string, sourcePath: string, range: vscode.Range, kind: string, comment: string, sourceLine: number) {
        this.targetPath = targetPath;
        this.sourcePath = sourcePath;
        this.range = range;
        this.kind = kind;
        this.comment = comment;
        this.sourceLine = sourceLine;
        // This is used as an index for the Set containing these since we can't use objects
        this.key = (targetPath + sourcePath + range.start.line + ":" + range.end.line);
    }
}

function getDeletedReferences(prevMatches: Set<string>, currMatches: Set<string>): string[] {
    let result: string[] = [];
    for (let prevMatch of prevMatches) {
        if (!currMatches.has(prevMatch)) {
            result.push(prevMatch);
        }
    }

    return result;
}

export class HighlightState implements FileChangeWatcher {
    // Maps a targetPath to the list of applicable CoverageRange object keys
    // Why not a set of CoverageRange? Because javascript hasn't figured out how to do hashCodes for objects yet
    // Which is just incredible
    // These are what are used to actually render match ranges upon request by the EditorWatcher subscriber
    keyToCoverageMap: Map<string, CoverageRange> = new Map();
    targetToCoverageMap: Map<string, Set<string>> = new Map();

    // Maps a sourcePath to the list of CoverageRanges it 'owns'
    // We use this when a file is deleted or modified to remove the matches created by it
    sourceToCoverageMap: Map<string, Set<string>> = new Map();

    regexHandler: RegexHandler = new RegexHandler();

    constructor() {
        
    }

    onFileChange(uri: vscode.Uri) {
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
                for (let coverageRange of this.regexHandler.checkForRanges(lines[i], basePath, sourcePath, i + 1)) {
                    // console.debug("Found coverage range mapping from " + coverageRange.sourcePath + " to " + coverageRange.targetPath);
                    let set = this.targetToCoverageMap.get(coverageRange.targetPath);
                    if (!set) {
                        set = new Set<string>();
                        this.targetToCoverageMap.set(coverageRange.targetPath, set);
                    }
                    set.add(coverageRange.key);
                    this.keyToCoverageMap.set(coverageRange.key, coverageRange);
                    currMatches.add(coverageRange.key);
                    changedFiles.add(coverageRange.targetPath);
                }
            }

            // If there is an existing array of coverage ranges sourced from this file,
            // make sure we remove any that aren't present anymore
            let prevMatches = this.sourceToCoverageMap.get(sourcePath);
            if (prevMatches) {
                let missing = getDeletedReferences(prevMatches, currMatches);
                for (let key of missing) {
                    console.log("Found missing key: " + key);
                    let coverage = this.keyToCoverageMap.get(key);
                    if (!coverage) {
                        // This shouldn't be possible
                        throw new Error("Missing coverage item");
                    }
                    let coverageMap = this.targetToCoverageMap.get(coverage.targetPath);
                    if (coverageMap) {
                        console.log("\tDeleting coverage key");
                        coverageMap.delete(coverage.key);
                        changedFiles.add(coverage.targetPath);
                    } else {
                        console.log("\tUnable to delete coverage key?");
                    }
                    this.keyToCoverageMap.delete(key); // We could probably leave it in-place, but no reason to let this map grow without bounds
                }
            }

            this.sourceToCoverageMap.set(sourcePath, currMatches);
        });
    }

    onFileDelete(uri: vscode.Uri) {
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