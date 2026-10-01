# luci-app-firewall — with rule groups

OpenWrt's LuCI firewall application, with one addition: **Port Forwards**,
**Traffic Rules**, **NAT Rules** and **IP Sets** can be split into named
groups, and each group gets its own sub-tab:

    Traffic Rules:  [ Default (9) ] [ myserver (3) ] [ vpn (2) ]

* **Add group…** creates a new, empty tab at the end.
* **Rename…**, **Delete…** and **◀ / ▶** act on the current group. Delete can
  either merge the group's rules into the previous group or remove them with
  it.
* **Add** inside a tab creates the rule in that group.
* Every edit dialog has a **Group** select that moves the rule to another group.
* Drag-sorting inside a tab works as before.

The *Default* tab holds everything that is not in a group, which on a stock
config is every rule. It is always the first tab and cannot be renamed or
removed.

## How groups are stored

A group is a marker section in `/etc/config/firewall`, placed right before the
rules it holds:

```
config rule                      # before any marker -> Default
	option name 'Allow-Ping'

config group
	option kind 'rule'           # rule | redirect | nat | ipset
	option name 'myserver'

config rule                      # -> myserver
	option name 'Allow-SSH'
```

A section belongs to the closest `group` marker of its kind that comes before
it. Nothing is added to the rules themselves. fw4 reads only the section types
it knows (`rule`, `redirect`, …), so it skips the markers without a warning.
Because groups are contiguous, **the tab order is the order fw4 evaluates the
rules in**. Moving a group with ◀ / ▶ changes that order.

A rule added from the command line (`uci add firewall rule`) goes to the end of
the config and therefore into the last group.

## Files

Everything outside these five files is byte-identical to
[openwrt/luci](https://github.com/openwrt/luci/tree/master/applications/luci-app-firewall)
master at `07bca003c7fe` (2026-09-30):

| file | change |
|---|---|
| `htdocs/luci-static/resources/tools/fwgroups.js` | new: marker scan, the `GroupSection` grid, the group dialogs |
| `htdocs/luci-static/resources/view/firewall/rules.js` | grid built per group |
| `htdocs/luci-static/resources/view/firewall/forwards.js` | grid built per group |
| `htdocs/luci-static/resources/view/firewall/snats.js` | grid built per group |
| `htdocs/luci-static/resources/view/firewall/ipsets.js` | grid built per group; the firewall4 note moved into the page description |

In the four views the changes are small: a `fwgroups.bind(m, kind, g => { … })`
wrapper, the Group select, and in `rules.js` and `forwards.js` one
`this.place(section_id)` call in `handleAdd`. The rest is re-indentation, so
`git diff -w` shows the real changes.

## Quick install

LuCI loads these files at runtime, so installing means copying five files.
No restart and no rebuild are needed.

```sh
ROUTER=root@192.168.1.1
R=/www/luci-static/resources

# keep the stock views so you can go back
ssh $ROUTER "tar czf /root/luci-app-firewall.orig.tgz -C $R \
             view/firewall/rules.js view/firewall/forwards.js \
             view/firewall/snats.js view/firewall/ipsets.js"

# install
for f in tools/fwgroups.js view/firewall/rules.js view/firewall/forwards.js \
         view/firewall/snats.js view/firewall/ipsets.js; do
    ssh $ROUTER "cat > $R/$f" < htdocs/luci-static/resources/$f
done
```

Then **hard-reload** the LuCI page (Ctrl-Shift-R). LuCI caches JS aggressively
and a normal reload keeps serving the old files.

## Quick uninstall

```sh
ssh $ROUTER 'tar xzf /root/luci-app-firewall.orig.tgz -C /www/luci-static/resources &&
             rm /www/luci-static/resources/tools/fwgroups.js'
```

or let the package manager restore the views:

```sh
ssh $ROUTER 'apk fix luci-app-firewall'                         # apk (25.x+)
ssh $ROUTER 'opkg install --force-reinstall luci-app-firewall'  # opkg
ssh $ROUTER 'rm /www/luci-static/resources/tools/fwgroups.js'
```

Hard-reload again afterwards. fw4 and stock LuCI both ignore the leftover
`config group` markers, and the rules keep their order. To remove the markers:

```sh
ssh $ROUTER 'while uci -q delete firewall.@group[0]; do :; done; uci commit firewall'
```

## Installing as a package

To build it into an image or an `.apk`/`.ipk`, put the tree in an OpenWrt
build root or SDK as `feeds/luci/applications/luci-app-firewall`, replacing
the stock one, and build `luci-app-firewall` as usual. The `Makefile` is
unchanged.

## License

Apache-2.0, as upstream.
