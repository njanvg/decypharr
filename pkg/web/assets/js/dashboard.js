// Dashboard functionality for torrent management
class TorrentDashboard {
    constructor() {
        console.log('[Dashboard] Constructor called');
        this.state = {
            torrents: [],
            selectedTorrents: new Set(),
            categories: new Set(),
            filteredTorrents: [],
            selectedCategory: '',
            selectedState: '',
            searchTerm: '',
            sortBy: 'added_on',
            itemsPerPage: 20,
            currentPage: 1,
            selectedTorrentContextMenu: null
        };

        this.refs = {
            torrentsList: document.getElementById('torrentsList'),
            searchInput: document.getElementById('searchInput'),
            categoryFilter: document.getElementById('categoryFilter'),
            stateFilter: document.getElementById('stateFilter'),
            sortSelector: document.getElementById('sortSelector'),
            selectAll: document.getElementById('selectAll'),
            batchDeleteBtn: document.getElementById('batchDeleteBtn'),
            batchDeleteDebridBtn: document.getElementById('batchDeleteDebridBtn'),
            refreshBtn: document.getElementById('refreshBtn'),
            torrentContextMenu: document.getElementById('torrentContextMenu'),
            paginationControls: document.getElementById('paginationControls'),
            paginationInfo: document.getElementById('paginationInfo'),
            emptyState: document.getElementById('emptyState')
        };
        
        console.log('[Dashboard] searchInput ref:', this.refs.searchInput);
        console.log('[Dashboard] All refs:', Object.keys(this.refs).map(k => k + ': ' + (this.refs[k] ? 'found' : 'NOT FOUND')).join(', '));

        this.init();
    }

    init() {
        console.log('[Dashboard] init() called');
        try {
            this.bindEvents();
            console.log('[Dashboard] bindEvents completed');
        } catch (e) {
            console.error('[Dashboard] Error in bindEvents:', e);
        }
        
        try {
            this.loadTorrents();
            console.log('[Dashboard] loadTorrents started');
        } catch (e) {
            console.error('[Dashboard] Error in loadTorrents:', e);
        }
        
        try {
            this.startAutoRefresh();
            console.log('[Dashboard] startAutoRefresh started');
        } catch (e) {
            console.error('[Dashboard] Error in startAutoRefresh:', e);
        }
    }

    bindEvents() {
        console.log('[Dashboard] bindEvents called');
        // Refresh button
        this.refs.refreshBtn.addEventListener('click', () => this.loadTorrents());

        // Batch delete
        this.refs.batchDeleteBtn.addEventListener('click', () => this.deleteSelectedTorrents());
        this.refs.batchDeleteDebridBtn.addEventListener('click', () => this.deleteSelectedTorrents(true));

        // Select all checkbox
        this.refs.selectAll.addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));

        // Search input - attach immediately without setTimeout
        try {
            if (this.refs.searchInput) {
                console.log('[Dashboard] Attaching search input listener');
                this.refs.searchInput.addEventListener('input', (e) => {
                    console.log('[Dashboard] Search input changed to:', e.target.value);
                    this.state.searchTerm = e.target.value;
                    this.state.currentPage = 1;
                    this.updateUI();
                });
                console.log('[Dashboard] Search listener attached successfully');
            } else {
                console.error('[Dashboard] searchInput not found! refs:', Object.keys(this.refs));
            }
        } catch (e) {
            console.error('[Dashboard] Error attaching search listener:', e);
        }

        // Filters
        this.refs.categoryFilter.addEventListener('change', (e) => this.setFilter('category', e.target.value));
        this.refs.stateFilter.addEventListener('change', (e) => this.setFilter('state', e.target.value));
        this.refs.sortSelector.addEventListener('change', (e) => this.setSort(e.target.value));

        // Context menu
        this.bindContextMenu();

        // Torrent selection
        this.refs.torrentsList.addEventListener('change', (e) => {
            if (e.target.classList.contains('torrent-select')) {
                this.toggleTorrentSelection(e.target.dataset.hash, e.target.checked);
            }
        });

        // Row action buttons
        this.refs.torrentsList.addEventListener('click', async (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            const row = button.closest('tr[data-hash]');
            if (!row) return;

            const action = button.dataset.action;
            const hash = row.dataset.hash;
            const category = row.dataset.category || '';
            const magnetUri = row.dataset.magnetUri || '';
            const name = row.dataset.name || '';

            if (action === 'download-torrent') {
                await this.downloadTorrentFile(name, category, hash);
                return;
            }

            if (action === 'download-magnet') {
                this.downloadMagnetFile(name, hash, magnetUri);
                return;
            }

            if (action === 'copy-magnet') {
                await this.copyMagnet(hash, magnetUri);
                return;
            }

            if (action === 'delete-local') {
                await this.deleteTorrent(hash, category, false);
                return;
            }

            if (action === 'delete-debrid') {
                await this.deleteTorrent(hash, category, true);
            }
        });
    }

    bindContextMenu() {
        // Show context menu
        this.refs.torrentsList.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('tr[data-hash]');
            if (!row) return;

            e.preventDefault();
            this.showContextMenu(e, row);
        });

        // Hide context menu
        document.addEventListener('click', (e) => {
            if (!this.refs.torrentContextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });

        // Context menu actions
        this.refs.torrentContextMenu.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action) {
                this.handleContextAction(action);
                this.hideContextMenu();
            }
        });
    }

    showContextMenu(event, row) {
        this.state.selectedTorrentContextMenu = {
            hash: row.dataset.hash,
            name: row.dataset.name,
            category: row.dataset.category || '',
            magnetUri: row.dataset.magnetUri || ''
        };

        this.refs.torrentContextMenu.querySelector('.torrent-name').textContent =
            this.state.selectedTorrentContextMenu.name;

        const { pageX, pageY } = event;
        const { clientWidth, clientHeight } = document.documentElement;
        const menu = this.refs.torrentContextMenu;

        // Position the menu
        menu.style.left = `${Math.min(pageX, clientWidth - 200)}px`;
        menu.style.top = `${Math.min(pageY, clientHeight - 150)}px`;

        menu.classList.remove('hidden');
    }

    hideContextMenu() {
        this.refs.torrentContextMenu.classList.add('hidden');
        this.state.selectedTorrentContextMenu = null;
    }

    async handleContextAction(action) {
        const torrent = this.state.selectedTorrentContextMenu;
        if (!torrent) return;

        const actions = {
            'copy-magnet': async () => {
                await this.copyMagnet(torrent.hash, torrent.magnetUri);
            },
            'copy-name': async () => {
                try {
                    await navigator.clipboard.writeText(torrent.name);
                    window.decypharrUtils.createToast('Torrent name copied to clipboard');
                } catch (error) {
                    window.decypharrUtils.createToast('Failed to copy torrent name', 'error');
                }
            },
            'delete': async () => {
                await this.deleteTorrent(torrent.hash, torrent.category, false);
            }
        };

        if (actions[action]) {
            await actions[action]();
        }
    }

    async loadTorrents() {
        try {
            // Show loading state
            this.refs.refreshBtn.disabled = true;
            this.refs.paginationInfo.textContent = 'Loading torrents...';

            const response = await window.decypharrUtils.fetcher('/api/torrents');
            if (!response.ok) throw new Error('Failed to fetch torrents');

            const torrents = await response.json();
            this.state.torrents = torrents;
            this.state.categories = new Set(torrents.map(t => t.category).filter(Boolean));

            this.updateUI();

        } catch (error) {
            console.error('Error loading torrents:', error);
            window.decypharrUtils.createToast(`Error loading torrents: ${error.message}`, 'error');
        } finally {
            this.refs.refreshBtn.disabled = false;
        }
    }

    updateUI() {
        console.log('[Dashboard] updateUI called');
        // Filter torrents
        this.filterTorrents();

        // Update category dropdown
        this.updateCategoryFilter();

        // Render torrents table
        console.log('[Dashboard] About to render', this.state.filteredTorrents.length, 'filtered torrents');
        this.renderTorrents();

        // Update pagination
        this.updatePagination();

        // Update selection state
        this.updateSelectionUI();

        // Show/hide empty state
        this.toggleEmptyState();
    }

    filterTorrents() {
        console.log('[Dashboard] filterTorrents called, current searchTerm:', this.state.searchTerm);
        let filtered = [...this.state.torrents];
        console.log('[Dashboard] Starting with', filtered.length, 'torrents');

        // Search filter with better null/undefined handling
        const searchTerm = (this.state.searchTerm || '').trim().toLowerCase();
        if (searchTerm.length > 0) {
            console.log('[Dashboard] Applying search filter for term:', searchTerm);
            filtered = filtered.filter(t => {
                const name = (t.name || '').toLowerCase();
                const match = name.includes(searchTerm);
                if (match) {
                    console.log('[Dashboard] Match found:', t.name);
                }
                return match;
            });
            console.log('[Dashboard] After search filter:', filtered.length, 'matches');
        }

        // Category filter
        if (this.state.selectedCategory) {
            console.log('[Dashboard] Applying category filter:', this.state.selectedCategory);
            filtered = filtered.filter(t => t.category === this.state.selectedCategory);
            console.log('[Dashboard] After category filter:', filtered.length, 'items');
        }

        // State filter
        if (this.state.selectedState) {
            console.log('[Dashboard] Applying state filter:', this.state.selectedState);
            filtered = filtered.filter(t => (t.state || '').toLowerCase() === this.state.selectedState.toLowerCase());
            console.log('[Dashboard] After state filter:', filtered.length, 'items');
        }

        // Sort torrents
        filtered = this.sortTorrents(filtered);
        console.log('[Dashboard] After sorting:', filtered.length, 'items');

        this.state.filteredTorrents = filtered;
    }

    sortTorrents(torrents) {
        const [field, direction] = this.state.sortBy.includes('_asc') || this.state.sortBy.includes('_desc')
            ? [this.state.sortBy.split('_').slice(0, -1).join('_'), this.state.sortBy.endsWith('_asc') ? 'asc' : 'desc']
            : [this.state.sortBy, 'desc'];

        return torrents.sort((a, b) => {
            let valueA, valueB;

            switch (field) {
                case 'name':
                    valueA = a.name?.toLowerCase() || '';
                    valueB = b.name?.toLowerCase() || '';
                    break;
                case 'size':
                    valueA = a.size || 0;
                    valueB = b.size || 0;
                    break;
                case 'progress':
                    valueA = a.progress || 0;
                    valueB = b.progress || 0;
                    break;
                case 'added_on':
                    valueA = a.added_on || 0;
                    valueB = b.added_on || 0;
                    break;
                default:
                    valueA = a[field] || 0;
                    valueB = b[field] || 0;
            }

            if (typeof valueA === 'string') {
                return direction === 'asc'
                    ? valueA.localeCompare(valueB)
                    : valueB.localeCompare(valueA);
            } else {
                return direction === 'asc'
                    ? valueA - valueB
                    : valueB - valueA;
            }
        });
    }

    renderTorrents() {
        const startIndex = (this.state.currentPage - 1) * this.state.itemsPerPage;
        const endIndex = Math.min(startIndex + this.state.itemsPerPage, this.state.filteredTorrents.length);
        const pageItems = this.state.filteredTorrents.slice(startIndex, endIndex);

        this.refs.torrentsList.innerHTML = pageItems.map(torrent => this.torrentRowTemplate(torrent)).join('');
    }

    torrentRowTemplate(torrent) {
        const progressPercent = (torrent.progress * 100).toFixed(1);
        const isSelected = this.state.selectedTorrents.has(torrent.hash);
        const magnetUri = this.normalizeMagnetUri(torrent.magnet_uri, torrent.hash);

        return `
            <tr data-hash="${torrent.hash}" 
                data-name="${this.escapeHtml(torrent.name)}" 
                data-category="${this.escapeHtml(torrent.category || '')}"
                data-magnet-uri="${this.escapeHtml(magnetUri)}"
                data-has-torrent-path="${torrent.TorrentPath ? 'true' : 'false'}"
                class="hover:bg-base-200 transition-colors">
                <td class="w-10">
                    <label class="cursor-pointer">
                        <input type="checkbox" 
                               class="checkbox checkbox-sm torrent-select" 
                               data-hash="${torrent.hash}" 
                               ${isSelected ? 'checked' : ''}>
                    </label>
                </td>
                <td class="min-w-48">
                    <div class="truncate font-medium" title="${this.escapeHtml(torrent.name)}">
                        ${this.escapeHtml(torrent.name)}
                    </div>
                </td>
                <td class="min-w-24 text-nowrap font-mono text-sm">
                    ${window.decypharrUtils.formatBytes(torrent.size)}
                </td>
                <td class="min-w-32">
                    <div class="flex items-center gap-3">
                        <progress class="progress progress-primary w-20 h-2" 
                                  value="${progressPercent}" 
                                  max="100"></progress>
                        <span class="text-sm font-medium min-w-12">${progressPercent}%</span>
                    </div>
                </td>
                <td class="min-w-20 text-nowrap font-mono text-sm">
                    ${window.decypharrUtils.formatSpeed(torrent.dlspeed)}
                </td>
                <td class="min-w-16">
                    <div class="flex gap-1">
                        <button class="btn btn-outline btn-xs tooltip"
                                data-action="download-torrent"
                                data-tip="Download torrent file">
                            <i class="bi bi-file-earmark-arrow-down"></i>
                        </button>
                    </div>
                </td>
                <td class="min-w-24">
                    ${torrent.category ?
            `<div class="badge badge-secondary badge-sm">${this.escapeHtml(torrent.category)}</div>` :
            '<span class="text-base-content/50">None</span>'
        }
                </td>
                <td class="min-w-24">
                    ${torrent.debrid ?
            `<div class="badge badge-accent badge-sm">${this.escapeHtml(torrent.debrid)}</div>` :
            '<span class="text-base-content/50">None</span>'
        }
                </td>
                <td class="min-w-16 text-nowrap font-mono text-sm">
                    ${torrent.num_seeds || 0}
                </td>
                <td class="min-w-20">
                    <div class="badge ${this.getStateColor(torrent.state)} badge-sm">
                        ${this.escapeHtml(torrent.state)}
                    </div>
                </td>
                <td class="w-32">
                    <div class="flex gap-1 flex-wrap">
                        <button class="btn btn-outline btn-xs tooltip"
                                data-action="download-magnet"
                                data-tip="Download magnet file">
                            <i class="bi bi-magnet"></i>
                        </button>
                        <button class="btn btn-outline btn-xs tooltip"
                                data-action="copy-magnet"
                                data-tip="Copy magnet link">
                            <i class="bi bi-copy"></i>
                        </button>
                        <button class="btn btn-error btn-outline btn-xs tooltip" 
                                data-action="delete-local"
                                data-tip="Delete from local">
                            <i class="bi bi-trash"></i>
                        </button>
                        ${torrent.debrid && torrent.id ? `
                            <button class="btn btn-error btn-outline btn-xs tooltip" 
                                    data-action="delete-debrid"
                                    data-tip="Remove from ${torrent.debrid}">
                                <i class="bi bi-cloud-slash"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }

    getStateColor(state) {
        const stateColors = {
            'downloading': 'badge-primary',
            'pausedup': 'badge-success',
            'error': 'badge-error',
            'completed': 'badge-success'
        };
        return stateColors[state?.toLowerCase()] || 'badge-ghost';
    }

    updateCategoryFilter() {
        const currentCategories = Array.from(this.state.categories).sort();
        const categoryOptions = ['<option value="">All Categories</option>']
            .concat(currentCategories.map(cat =>
                `<option value="${this.escapeHtml(cat)}" ${cat === this.state.selectedCategory ? 'selected' : ''}>
                    ${this.escapeHtml(cat)}
                </option>`
            ));
        this.refs.categoryFilter.innerHTML = categoryOptions.join('');
    }

    updatePagination() {
        const totalPages = Math.ceil(this.state.filteredTorrents.length / this.state.itemsPerPage);
        const startIndex = (this.state.currentPage - 1) * this.state.itemsPerPage;
        const endIndex = Math.min(startIndex + this.state.itemsPerPage, this.state.filteredTorrents.length);

        // Update pagination info
        this.refs.paginationInfo.textContent =
            `Showing ${this.state.filteredTorrents.length > 0 ? startIndex + 1 : 0}-${endIndex} of ${this.state.filteredTorrents.length} torrents`;

        // Clear pagination controls
        this.refs.paginationControls.innerHTML = '';

        if (totalPages <= 1) return;

        // Previous button
        const prevBtn = this.createPaginationButton('❮', this.state.currentPage - 1, this.state.currentPage === 1);
        this.refs.paginationControls.appendChild(prevBtn);

        // Page numbers
        const maxPageButtons = 5;
        let startPage = Math.max(1, this.state.currentPage - Math.floor(maxPageButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxPageButtons - 1);

        if (endPage - startPage + 1 < maxPageButtons) {
            startPage = Math.max(1, endPage - maxPageButtons + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = this.createPaginationButton(i, i, false, i === this.state.currentPage);
            this.refs.paginationControls.appendChild(pageBtn);
        }

        // Next button
        const nextBtn = this.createPaginationButton('❯', this.state.currentPage + 1, this.state.currentPage === totalPages);
        this.refs.paginationControls.appendChild(nextBtn);
    }

    createPaginationButton(text, page, disabled = false, active = false) {
        const button = document.createElement('button');
        button.className = `join-item btn btn-sm ${active ? 'btn-active' : ''} ${disabled ? 'btn-disabled' : ''}`;
        button.textContent = text;
        button.disabled = disabled;

        if (!disabled) {
            button.addEventListener('click', () => {
                this.state.currentPage = page;
                this.updateUI();
            });
        }

        return button;
    }

    updateSelectionUI() {
        // Clean up selected torrents that no longer exist
        const currentHashes = new Set(this.state.filteredTorrents.map(t => t.hash));
        this.state.selectedTorrents.forEach(hash => {
            if (!currentHashes.has(hash)) {
                this.state.selectedTorrents.delete(hash);
            }
        });

        // Update batch delete button
        this.refs.batchDeleteBtn.classList.toggle('hidden', this.state.selectedTorrents.size === 0);
        this.refs.batchDeleteDebridBtn.classList.toggle('hidden', this.state.selectedTorrents.size === 0);

        // Update select all checkbox
        const visibleTorrents = this.state.filteredTorrents.slice(
            (this.state.currentPage - 1) * this.state.itemsPerPage,
            this.state.currentPage * this.state.itemsPerPage
        );

        this.refs.selectAll.checked = visibleTorrents.length > 0 &&
            visibleTorrents.every(torrent => this.state.selectedTorrents.has(torrent.hash));
        this.refs.selectAll.indeterminate = visibleTorrents.some(torrent => this.state.selectedTorrents.has(torrent.hash)) &&
            !visibleTorrents.every(torrent => this.state.selectedTorrents.has(torrent.hash));
    }

    toggleEmptyState() {
        const isEmpty = this.state.torrents.length === 0;
        this.refs.emptyState.classList.toggle('hidden', !isEmpty);
        document.querySelector('.card:has(#torrentsList)').classList.toggle('hidden', isEmpty);
    }

    // Event handlers
    setFilter(type, value) {
        if (type === 'category') {
            this.state.selectedCategory = value;
        } else if (type === 'state') {
            this.state.selectedState = value;
        }
        this.state.currentPage = 1;
        this.updateUI();
    }

    // Removed setSearch method - inline in bindEvents for reliability

    setSort(sortBy) {
        this.state.sortBy = sortBy;
        this.state.currentPage = 1;
        this.updateUI();
    }

    toggleSelectAll(checked) {
        const visibleTorrents = this.state.filteredTorrents.slice(
            (this.state.currentPage - 1) * this.state.itemsPerPage,
            this.state.currentPage * this.state.itemsPerPage
        );

        visibleTorrents.forEach(torrent => {
            if (checked) {
                this.state.selectedTorrents.add(torrent.hash);
            } else {
                this.state.selectedTorrents.delete(torrent.hash);
            }
        });

        this.updateUI();
    }

    toggleTorrentSelection(hash, checked) {
        if (checked) {
            this.state.selectedTorrents.add(hash);
        } else {
            this.state.selectedTorrents.delete(hash);
        }
        this.updateSelectionUI();
    }

    async deleteTorrent(hash, category, removeFromDebrid = false) {
        if (!confirm(`Are you sure you want to delete this torrent${removeFromDebrid ? ' from ' + category : ''}?`)) {
            return;
        }

        try {
            const endpoint = `/api/torrents/${encodeURIComponent(category)}/${hash}?removeFromDebrid=${removeFromDebrid}`;
            const response = await window.decypharrUtils.fetcher(endpoint, { method: 'DELETE' });

            if (!response.ok) throw new Error(await response.text());

            window.decypharrUtils.createToast('Torrent deleted successfully');
            await this.loadTorrents();

        } catch (error) {
            console.error('Error deleting torrent:', error);
            window.decypharrUtils.createToast(`Failed to delete torrent: ${error.message}`, 'error');
        }
    }

    async deleteSelectedTorrents(removeFromDebrid = false) {
        const count = this.state.selectedTorrents.size;
        if (count === 0) {
            window.decypharrUtils.createToast('No torrents selected for deletion', 'warning');
            return;
        }
        if (!confirm(`Are you sure you want to delete ${count} torrent${count > 1 ? 's' : ''}${removeFromDebrid ? ' from debrid' : ''}?`)) {
            return;
        }

        try {
            const hashes = Array.from(this.state.selectedTorrents).join(',');
            const response = await window.decypharrUtils.fetcher(
                `/api/torrents/?hashes=${encodeURIComponent(hashes)}&removeFromDebrid=${removeFromDebrid}`,
                { method: 'DELETE' }
            );

            if (!response.ok) throw new Error(await response.text());

            window.decypharrUtils.createToast(`${count} torrent${count > 1 ? 's' : ''} deleted successfully`);
            this.state.selectedTorrents.clear();
            await this.loadTorrents();

        } catch (error) {
            console.error('Error deleting torrents:', error);
            window.decypharrUtils.createToast(`Failed to delete some torrents: ${error.message}`, 'error');
        }
    }

    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            this.loadTorrents();
        }, 5000);

        // Clean up on page unload
        window.addEventListener('beforeunload', () => {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
        });
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text ? text.replace(/[&<>"']/g, (m) => map[m]) : '';
    }

    normalizeMagnetUri(rawMagnet, hash) {
        let magnetUri = (rawMagnet || '').trim();

        for (let i = 0; i < 2; i++) {
            if (!magnetUri || magnetUri.toLowerCase().startsWith('magnet:?')) {
                break;
            }
            try {
                const decoded = decodeURIComponent(magnetUri);
                if (decoded === magnetUri) {
                    break;
                }
                magnetUri = decoded.trim();
            } catch (_) {
                break;
            }
        }

        if (!magnetUri && hash) {
            return `magnet:?xt=urn:btih:${hash}`;
        }

        if (!magnetUri.toLowerCase().startsWith('magnet:?') && hash) {
            return `magnet:?xt=urn:btih:${hash}`;
        }

        return magnetUri;
    }

    formatErrorMessage(base, error) {
        const details = error?.stack || error?.message || String(error);
        return `${base}\n${details}`;
    }

    async copyMagnet(hash, rawMagnet) {
        const magnetUri = this.normalizeMagnetUri(rawMagnet, hash);
        if (!magnetUri) {
            window.decypharrUtils.createToast('No magnet link found for this torrent', 'warning');
            return;
        }

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(magnetUri);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = magnetUri;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '0';
                textarea.setAttribute('readonly', '');
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();

                if (!document.execCommand('copy')) {
                    throw new Error('Clipboard API not available');
                }

                document.body.removeChild(textarea);
            }

            window.decypharrUtils.createToast('Magnet link copied to clipboard');
        } catch (error) {
            console.error('Failed to copy magnet link:', error);
            window.decypharrUtils.createToast(this.formatErrorMessage('Failed to copy magnet link', error), 'error');
        }
    }

    async downloadTorrentFile(name, category, hash) {
        const safeCategory = category || '';
        const url = `/api/torrents/download?hash=${encodeURIComponent(hash)}&category=${encodeURIComponent(safeCategory)}`;

        try {
            const response = await window.decypharrUtils.fetcher(url, { method: 'GET' });
            if (!response.ok) {
                let errorText = '';
                const contentType = response.headers.get('Content-Type') || '';

                if (contentType.includes('application/json')) {
                    const body = await response.json().catch(() => null);
                    errorText = body?.error || body?.message || JSON.stringify(body || '');
                } else {
                    errorText = await response.text();
                }

                errorText = errorText?.trim() || response.statusText || `HTTP ${response.status}`;
                window.decypharrUtils.createToast(`Failed to download torrent: ${errorText}`, 'error');
                return;
            }

            const contentType = response.headers.get('Content-Type') || '';
            const isMagnetFallback = contentType.includes('text/plain');
            const blob = await response.blob();
            const safeName = (name || hash || 'torrent')
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
                .trim()
                .slice(0, 120);
            const fileName = `${safeName || 'torrent'}${isMagnetFallback ? '.magnet' : '.torrent'}`;
            const downloadUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = downloadUrl;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(downloadUrl);
            window.decypharrUtils.createToast(isMagnetFallback ? 'Magnet file downloaded' : 'Torrent file downloaded');
        } catch (error) {
            console.error('Error downloading torrent file:', error);
            window.decypharrUtils.createToast(this.formatErrorMessage('Failed to download torrent file', error), 'error');
        }
    }

    downloadMagnetFile(name, hash, rawMagnet) {
        const magnetUri = this.normalizeMagnetUri(rawMagnet, hash);
        if (!magnetUri) {
            window.decypharrUtils.createToast('No magnet link found for this torrent', 'warning');
            return;
        }

        const safeName = (name || hash || 'torrent')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .trim()
            .slice(0, 120);

        const blob = new Blob([`${magnetUri}\n`], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${safeName || 'torrent'}.magnet`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        window.decypharrUtils.createToast('Magnet file downloaded');
    }
}
