"""Test helper for tests/object_api_parity.mjs: the public names of the
tfstudio package's objects, read from its source with ast, so that nothing of
the package runs.

    python -B -I tests/_pythonNames.py <folder holding tfstudio>

stdout gets one JSON object: "all", the names the package's __all__ lists,
and "classes", each of those that is a class, by its name, with its public
methods and attributes and the operators __len__, __getitem__ and __iter__
where it has them.
"""

import ast
import json
import os
import sys

OPERATORS = ("__len__", "__getitem__", "__iter__")


def parsed(path):
    with open(path, encoding="utf-8") as file:
        return ast.parse(file.read(), path)


def listed(package):
    """The names __init__.py's __all__ lists."""
    for node in parsed(os.path.join(package, "__init__.py")).body:
        if isinstance(node, ast.Assign) and any(getattr(target, "id", None) == "__all__" for target in node.targets):
            return ast.literal_eval(node.value)
    return []


def members(cls):
    """The methods, properties and class attributes of the class `cls` that
    a program uses: those whose name does not start with _, and the
    operators."""
    names = set()
    for node in cls.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(target.id for target in node.targets if isinstance(target, ast.Name))
    return sorted(name for name in names if not name.startswith("_") or name in OPERATORS)


def names(package):
    exported = listed(package)
    classes = {}
    for file in sorted(os.listdir(package)):
        if file.endswith(".py"):
            for node in parsed(os.path.join(package, file)).body:
                if isinstance(node, ast.ClassDef) and node.name in exported:
                    classes[node.name] = members(node)
    return {"all": exported, "classes": classes}


if __name__ == "__main__":
    print(json.dumps(names(os.path.join(sys.argv[1], "tfstudio"))))
