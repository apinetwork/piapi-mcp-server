# 3D `.glb` preview

The MCP Apps media gallery renders recognized `.glb` assets with a bundled
Three.js `GLTFLoader` and orbit controls. It does not use a remote script CDN:
the renderer is part of the `ui://piapi/media-gallery` resource, and the model
file itself is fetched only when its HTTPS origin passes the configured
`PIAPI_MEDIA_RESOURCE_DOMAINS` allowlist.

The gallery deliberately does not render `.obj` inline yet. OBJ output may
depend on companion MTL files, textures, and loader-specific path handling;
the standard `resource_link` remains available for it. This keeps the first 3D
preview path constrained to self-contained GLB artifacts.

If a host disables WebGL, its sandbox blocks model fetching, the asset URL has
expired, or the GLB cannot load, the UI displays a short fallback message and
retains the original download link. This is the same progressive-degradation
rule used for clients without MCP Apps support.
