# Model asset sources

The Xenon 60 GLB beside this file is generated in this repository and exists as a
structural regression fixture. The more representative showcase is installed by
`npm --prefix visuals run model:showcase -- --install`. That explicit authoring
command downloads these pinned files, checks their SHA-256 digests, and imports
them into OpenFlow's content-addressed local model library. Rendering never uses
the network.

| asset | source | license | SHA-256 |
|---|---|---|---|
| Fox | [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox) | model [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); rigging/animation and glTF conversion [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), credited to PixelMannen, tomkranis, AsoboStudio and scurest | `d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7` |
| Toy Car | [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), by Guido Odendahl and Eric Chadwick | `01a60862de55cd4b9f3acfab0b0def86451800f9c42467fcd61052c16cb9838c` |

See each linked upstream README for the complete legal notice. The downloader
keeps the source bytes unmodified and stores the original filename as provenance.
