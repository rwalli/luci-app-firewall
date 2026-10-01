'use strict';
'require baseclass';
'require dom';
'require ui';
'require uci';
'require form';

/*
 Rule groups are marker sections placed between the sections they group:

	config group
		option kind 'rule'		# rule | redirect | nat | ipset
		option name 'myserver'

 A section of type <kind> belongs to the closest preceding marker of the
 same kind, sections before the first marker form the "Default" group.
 fw4 only walks the section types it knows, so the markers are ignored
 there and the group order is the evaluation order.
*/

const MARKER = 'group';

function scan(kind) {
	const groups = [ { sid: null, name: _('Default'), members: [] } ];

	for (const s of uci.sections('firewall')) {
		if (s['.type'] == MARKER && s.kind == kind)
			groups.push({ sid: s['.name'], name: s.name || _('Unnamed group'), members: [] });
		else if (s['.type'] == kind)
			groups[groups.length - 1].members.push(s['.name']);
	}

	groups.forEach((g, i) => g.index = i);

	return groups;
}

function groupOf(kind, section_id) {
	for (const g of scan(kind))
		if (g.members.indexOf(section_id) > -1)
			return g.sid;

	return null;
}

/* move section_id to the end of the group identified by group_sid */
function place(kind, section_id, group_sid) {
	const groups = scan(kind);
	const g = groups.find(g => g.sid === group_sid);

	if (!g)
		return false;

	const members = g.members.filter(sid => sid != section_id);

	if (members.length)
		return uci.move('firewall', section_id, members[members.length - 1], true);

	if (g.sid)
		return uci.move('firewall', section_id, g.sid, true);

	const first = groups.find(g => g.sid);

	return first ? uci.move('firewall', section_id, first.sid, false) : true;
}

function selectTab(mapEl, index) {
	const a = mapEl?.querySelector(':scope > .cbi-tabmenu > li[data-tab="group-%d"] > a'.format(index));

	if (a)
		a.click();
}

/* show the toolbar of the active group tab in the page footer, left of Save & Apply */
function showToolbar(sectionEl, toolbar) {
	const actions = document.querySelector('#view .cbi-page-actions');

	if (!actions || sectionEl.getAttribute('data-tab-active') != 'true')
		return;

	actions.querySelector(':scope > .cbi-fwgroup-actions')?.remove();
	actions.insertBefore(toolbar, actions.firstChild);
}

/* parse the form, apply fn to the uci state, stage everything and re-render */
function regroup(map, fn) {
	let index = null;

	return map.save(() => { index = fn(); }, true).then(mapEl => {
		if (index != null)
			selectTab(mapEl, index);

		return mapEl;
	}).catch(e => {
		ui.addNotification(null, E('p', e.message), 'error');
	});
}

function promptName(title, value, taken, apply) {
	const input = new ui.Textfield(value, {
		placeholder: _('Group name'),
		validate(v) {
			v = (v ?? '').trim();

			if (v == '')
				return _('Expecting a non-empty name');

			if (taken.indexOf(v.toLowerCase()) > -1)
				return _('A group with this name already exists');

			return true;
		}
	});

	const submit = () => {
		input.triggerValidation();

		if (!input.isValid())
			return;

		ui.hideModal();

		return apply(input.getValue().trim());
	};

	ui.showModal(title, [
		E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, _('Name')),
			E('div', { 'class': 'cbi-value-field', 'keydown': ev => { if (ev.key == 'Enter') submit(); } }, input.render())
		]),
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')), ' ',
			E('button', { 'class': 'cbi-button cbi-button-positive important', 'click': submit }, _('Save'))
		])
	]);

	requestAnimationFrame(() => input.node.querySelector('input')?.focus());
}

const GroupSection = form.GridSection.extend({
	__init__(map, sectionType, group, ...args) {
		this.super('__init__', [ map, sectionType, group.name, ...args ]);

		this.group = group;
		this.hidetitle = true;
	},

	cfgsections() {
		const g = scan(this.sectiontype).find(g => g.sid === this.group.sid);
		const members = g ? g.members : [];

		return this.super('cfgsections', []).filter(sid => members.indexOf(sid) > -1);
	},

	/* put a freshly added section into this group */
	place(section_id) {
		return place(this.sectiontype, section_id, this.group.sid);
	},

	handleAdd(ev, name) {
		const section_id = this.map.data.add(this.uciconfig ?? this.map.config, this.sectiontype, name);

		this.place(section_id);
		this.map.addedSection = section_id;

		return this.renderMoreOptionsModal(section_id);
	},

	handleAddGroup() {
		const taken = scan(this.sectiontype).map(g => g.name.toLowerCase());

		promptName(_('Add group'), '', taken, name => regroup(this.map, () => {
			const sid = uci.add('firewall', MARKER);

			uci.set('firewall', sid, 'kind', this.sectiontype);
			uci.set('firewall', sid, 'name', name);

			return scan(this.sectiontype).length - 1;
		}));
	},

	handleRenameGroup() {
		const taken = scan(this.sectiontype)
			.filter(g => g.sid !== this.group.sid)
			.map(g => g.name.toLowerCase());

		promptName(_('Rename group'), this.group.name, taken, name => regroup(this.map, () => {
			uci.set('firewall', this.group.sid, 'name', name);

			return this.group.index;
		}));
	},

	handleDeleteGroup() {
		const groups = scan(this.sectiontype);
		const g = groups[this.group.index];
		const prev = groups[this.group.index - 1];

		ui.showModal(_('Delete group "%s"').format(g.name), [
			E('p', _('The group contains %d section(s).').format(g.members.length)),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, () => {
						ui.hideModal();

						return regroup(this.map, () => {
							uci.remove('firewall', g.sid);

							return prev.index;
						});
					})
				}, _('Merge into "%s"').format(prev.name)), ' ',
				E('button', {
					'class': 'cbi-button cbi-button-negative important',
					'click': ui.createHandlerFn(this, () => {
						ui.hideModal();

						return regroup(this.map, () => {
							for (const sid of g.members)
								uci.remove('firewall', sid);

							uci.remove('firewall', g.sid);

							return prev.index;
						});
					})
				}, g.members.length ? _('Delete group and its sections') : _('Delete group'))
			])
		]);
	},

	/* move the marker and all members of group index before the marker of the previous group */
	handleMoveGroup(index) {
		return regroup(this.map, () => {
			const groups = scan(this.sectiontype);
			const g = groups[index];
			const prev = groups[index - 1];

			if (!g?.sid || !prev?.sid)
				return null;

			for (const sid of [ g.sid, ...g.members ])
				uci.move('firewall', sid, prev.sid, false);

			return (index == this.group.index) ? index - 1 : index;
		});
	},

	renderGroupToolbar() {
		const count = scan(this.sectiontype).length;
		const index = this.group.index;
		const ro = this.map.readonly;
		const btn = (cls, title, disabled, fn) => E('button', {
			'class': 'cbi-button ' + cls,
			'disabled': (ro || disabled) ? '' : null,
			'click': ui.createHandlerFn(this, fn)
		}, title);

		const buttons = [ btn('cbi-button-add', _('Add group…'), false, 'handleAddGroup') ];

		if (this.group.sid)
			buttons.push(
				btn('cbi-button-edit', _('Rename…'), false, 'handleRenameGroup'),
				btn('cbi-button-remove', _('Delete…'), false, 'handleDeleteGroup'),
				btn('cbi-button-neutral', '◀', index < 2, () => this.handleMoveGroup(index)),
				btn('cbi-button-neutral', '▶', index + 1 >= count, () => this.handleMoveGroup(index + 1)));

		return E('div', {
			'class': 'cbi-fwgroup-actions',
			'style': 'float:left;display:flex;flex-wrap:wrap;gap:.5em'
		}, buttons);
	},

	renderContents(cfgsections, nodes) {
		const sectionEl = this.super('renderContents', [ cfgsections, nodes ]);

		sectionEl.id = 'cbi-%s-%s-group-%d'.format(this.uciconfig ?? this.map.config, this.sectiontype, this.group.index);

		if (this.map.tabbed) {
			sectionEl.setAttribute('data-tab', 'group-%d'.format(this.group.index));
			sectionEl.setAttribute('data-tab-title', '%s (%d)'.format(this.group.name, cfgsections.length));
		}

		const toolbar = this.renderGroupToolbar();

		/* fired by ui.tabs on the initial render and on every tab switch */
		sectionEl.addEventListener('cbi-tab-active', () => showToolbar(sectionEl, toolbar));

		return sectionEl;
	}
});

return baseclass.extend({
	GroupSection: GroupSection,

	list: scan,
	groupOf: groupOf,
	place: place,

	/*
	 Render one GroupSection per group as tabs of map. build(group) must
	 create the section with m.section(fwgroups.GroupSection, kind, group)
	 and its options; it is re-run on every load so the tabs follow the
	 staged uci state.
	*/
	bind(map, kind, build) {
		map.tabbed = true;
		map.loadChildren = function(...args) {
			this.children = [];

			for (const g of scan(kind))
				build(g);

			return form.Map.prototype.loadChildren.apply(this, args);
		};

		return map;
	},

	/* a modal-only "Group" select that moves the section between groups */
	addGroupOption(s, tab) {
		const kind = s.sectiontype;
		const o = tab
			? s.taboption(tab, form.ListValue, '_group', _('Group'))
			: s.option(form.ListValue, '_group', _('Group'));

		o.modalonly = true;
		o.rmempty = true;

		for (const g of scan(kind))
			o.value(g.sid ?? '', g.name);

		o.cfgvalue = function(section_id) {
			return groupOf(kind, section_id) ?? '';
		};

		o.write = function(section_id, value) {
			if (groupOf(kind, section_id) !== value)
				place(kind, section_id, value);
		};

		o.remove = function(section_id) {
			if (groupOf(kind, section_id) !== null)
				place(kind, section_id, null);
		};

		return o;
	}
});
