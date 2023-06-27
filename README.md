# Code Coverage From Comments

## Summary
The purpose of this project is to add a two-way linking between comments in one project and the source code of another. This is useful in code conversion projects where it becomes difficult to track what code has been handled and what code remains to be converted.

## Example
Consider a scenario where you are rewriting a python project into C#. Perhaps you have an ImageConvert class which converts between various types of image formats. Here is the Python implementation:
```python
class ImageConverter:
    def __init__(self, logger):
        self.logger = logger
    
    def convertToPng(image):
        pass # Implementation goes here
    
    def convertToJpg(image):
        pass # Implementation goes here
    
    def convertToBmp(image):
        pass # Implementation goes here
```

Now as you are converting this project into C#, you can add comments that reflect your progress on this project. It will also serve as a useful reference in case somebody wishes to see how the old project maps to the new one, and look up old implementation details if a bug arises. Here is an example of that:

```csharp
/// <summary>
/// This class converts between various types of images
/// </summary>
class ImageConverter {
    // python_src/images/image_converter.py:L5-L6 (COMPLETE)
    public PngImage ConvertToPng(Image image) {
        // Pretend this has been fully implemented
    }

    // python_src/images/image_converter.py:L8-L9 (WIP)
    public JpgImage ConvertToJpg(Image image) {
        // TODO
    }

    // python_src/images/image_converter.py:L11-L12 (IGNORED)
    public BmpImage ConvertToBmp(Image image) {
        // This was never used in the Python project, so we'll never implement this
    }
}
```

TODO - grab some images of what this scenario looks like (maybe make it fancy w/ a gif)

## Documentation
### Configuration
The following configuration options are available:

| Configuration Option | Type | Default Value | Description |
| -------------------- | ---- | ------------- | ----------- |
| coverage-from-comments.commentSourceFileTypes | Array | `["**/*.cs"]` | An array of glob patterns which match files relative to the opened project directory. These will be referenced to determine from which source files we should examine comments from. In the example given in this README, this should target C# files. |
| coverage-from-comments.renderFileTypes | Array | `["**/*.FOR", "**/*.INC", "**/*.PF"]` | An array of glob patterns which match files relative to the opened project directory. These will be referenced to determine which source files we should render the code coverage blocks in. In the example given in this README, this should target Python files. |


### Usage
The usage of this addon is as simple as enabling it and setting up the .vscode/settings.json file in the root directory where you wish to work. You can then begin making comments in the files matching the commentSourceFileTypes glob patterns, and rendering will show up in files matching the renderFileTypes glob patterns.

Here are the acceptable comment formats:
- `file_name_relative_to_project_directory:L{x}`, where `x` is the line number you wish highlighted
- `file_name_relative_to_project_directory:L{x}-L{y}`, where `Lx-Ly` is a range describing the line numbers you want highlighted
- `file_name_relative_to_project_directory:L{x1}-L{y1},L{x2}-L{y2},L{x3}-L{y3},...`, following the pattern described above

You can also add short descriptions to your comments without negatively impaacting anything, e.g.
- `file_name_relative_to_project_directory:L{x}-L{y} This is an implementation of some feature from the other project`


Finally, you may specify the following code as being `WIP`, `IGNORED`, or `COMPLETE`. This will change the color of the highlighting in the target files. `COMPLETE` is the default case so it may be removed if so desired.
- `file_name_relative_to_project_directory:L{x}-L{y} This is an implementation of some feature from the other project (WIP)`
