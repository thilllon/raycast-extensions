# Icon sources

`chrome-icon.svg` is the Chrome extension icon, `raycast-icon.svg` the Raycast extension icon.
Regenerate the PNGs on macOS without any dependency:

```sh
qlmanage -t -s 512 -o . chrome-icon.svg          # -> chrome-icon.svg.png
for s in 16 32 48 128; do
  sips -s format png -z $s $s chrome-icon.svg.png --out ../chrome-extension/icons/icon-$s.png
done
sips -s format png -z 512 512 raycast-icon.svg.png --out ../assets/extension-icon.png
```
