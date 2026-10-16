from setuptools import find_namespace_packages, setup

setup(
    name="cli-anything-veyrnox",
    version="1.0.0",
    description="Official command-line client for Veyrnox.ai",
    python_requires=">=3.10",
    packages=find_namespace_packages(include=["cli_anything.*"]),
    include_package_data=True,
    package_data={"cli_anything.veyrnox": ["skills/SKILL.md"]},
    install_requires=["click>=8.1,<9"],
    entry_points={"console_scripts": [
        "veyrnox=cli_anything.veyrnox.veyrnox_cli:main",
        "cli-anything-veyrnox=cli_anything.veyrnox.veyrnox_cli:main",
    ]},
)
