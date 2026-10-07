const API_BASE_URL = 'https://region9consolacion-backend.onrender.com';

let dashboardInterval = null;
let dutyChart = null;

let rawSalariesCache = [];
let salaryPersonnelCache = [];
let currentSalarySubView = 'ALL';
let currentNoWorkSubView = 'ALL';
let currentCitizensSubView = 'ALL';

const SALARY_GRADES = {
    "Patrolman": { baseSalary: 300000, incentives: 5000 },
    "Police Corporal": { baseSalary: 350000, incentives: 5000 },
    "Police Staff Sergeant": { baseSalary: 400000, incentives: 5000 },
    "Police Master Sergeant": { baseSalary: 450000, incentives: 5000 },
    "Police Senior Master Sergeant": { baseSalary: 500000, incentives: 5000 },
    "Police Chief Master Sergeant": { baseSalary: 550000, incentives: 5500 },
    "Police Executive Master Sergeant": { baseSalary: 600000, incentives: 5000 },
    "Police Lieutenant": { baseSalary: 700000, incentives: 10000 },
    "Police Captain": { baseSalary: 750000, incentives: 10000 },
    "Police Major": { baseSalary: 800000, incentives: 10000 },
    "Police Lieutenant Colonel": { baseSalary: 850000, incentives: 10000 },
    "Police Colonel": { baseSalary: 900000, incentives: 10000 },
    "Police Brigadier General": { baseSalary: 1000000, incentives: 10000 },
    "Police Major General": { baseSalary: 1050000, incentives: 10000 },
    "Police Lieutenant General": { baseSalary: 1150000, incentives: 10000 },
    "Police General": { baseSalary: 1250000, incentives: 10000 },
    "Mayor": { baseSalary: 500000, incentives: 10000 },
    "Secretary to the Mayor": { baseSalary: 300000 , incentives: 10000 },
    "Secretary to the Governor": { baseSalary: 300000 , incentives: 10000 },
    "Human Resources Manager": { baseSalary: 450000, incentives: 5000 },
    "Personal Assistant to the Mayor": { baseSalary: 300000, incentives: 10000 },
    "Personal Assistant to the Governor": { baseSalary: 300000, incentives: 10000 }
};

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJsArg(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function compareIDs(idA, idB) {
    const strA = (idA || '').toString();
    const strB = (idB || '').toString();

    const matchA = strA.match(/\d+/g);
    const matchB = strB.match(/\d+/g);

    const numA = matchA ? parseInt(matchA[matchA.length - 1], 10) : 0;
    const numB = matchB ? parseInt(matchB[matchB.length - 1], 10) : 0;

    if (numA !== numB) {
        return numA - numB;
    }

    return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
}

function parseCurrency(str) {
    if (!str) return 0;
    if (typeof str === 'number') return isNaN(str) ? 0 : str;
    return parseFloat(String(str).replace(/[^0-9.-]+/g, '')) || 0;
}

function formatCurrency(num) {
    return 'PHP ' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function triggerDailyQuotaReport() {
    if (!confirm("Are you sure you want to manually trigger the Daily Quota Report? This will send the summaries to Discord and reset all daily proof counts to 0.")) {
        return;
    }

    const btn = document.getElementById("triggerDailyReportBtn");
    if (btn) {
        btn.disabled = true;
        btn.innerText = "⏳ Dispatching...";
    }

    try {
        const res = await apiFetch('/api/salary/trigger-daily-report', {
            method: "POST"
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) {
            alert("✅ " + (data.message || "Daily report dispatched successfully!"));
            fetchSalaryData();
            loadNoWorkNoPayTab();
        } else {
            alert("❌ Error: " + (data.message || "Failed to trigger daily quota report."));
        }
    } catch (err) {
        console.error("Failed to execute daily quota report trigger:", err);
        alert("❌ Network error connecting to API server.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "☀️ Daily Report & Reset";
        }
    }
}

function getExportSalaryData() {
    if (!rawSalariesCache || !rawSalariesCache.length) return [];

    return rawSalariesCache.filter(item => {
        const dept = (item.department || (item.badge_id && String(item.badge_id).startsWith('GO') ? 'GOV' : 'PNP')).toUpperCase();
        if (currentSalarySubView === 'PNP') return dept === 'PNP';
        if (currentSalarySubView === 'GOV') return dept === 'GOV';
        return true;
    }).map(s => {
        const b = parseCurrency(s.salary || s.baseSalary);
        const fullWk = b / 4.0;
        const days = s.daysAttended || s.days_attended || (s.days !== undefined ? s.days : 0);
        const isGen = (s.title || '').toLowerCase() === 'police general';
        const proRatedBase = isGen ? fullWk : (fullWk / 7.0) * Math.min(7, days);
        const i = parseCurrency(s.incentives);
        const tw = proRatedBase + i;
        const dept = (s.department || (s.badge_id && String(s.badge_id).startsWith('GO') ? 'GOV' : 'PNP')).toUpperCase();

        return {
            badge: s.badge_id || s.badgeId || s.id || 'N/A',
            department: dept,
            title: s.title || 'N/A',
            name: s.name || 'N/A',
            baseSalary: b,
            fullWeekly: fullWk,
            proRatedBase: proRatedBase,
            incentives: i,
            totalWeekly: tw,
            status: (s.status || 'unpaid').toUpperCase()
        };
    });
}

function switchDepartmentTab(tabId) {
    document.querySelectorAll('.dept-sub-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.sub-tab-btn').forEach(el => el.classList.remove('active'));

    const target = document.getElementById('dept-' + tabId);
    if (target) target.style.display = 'block';

    event.currentTarget.classList.add('active');
}

async function exportCitizensList() {
    const btn = document.getElementById('btn-export-citizens');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dispatching Citizens...';

    try {
        const token = localStorage.getItem('staffToken');
        const response = await fetch(`${API_BASE_URL}/api/citizens/notify-channel`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                dispatchedBy: localStorage.getItem('username') || 'Admin'
            })
        });

        if (response.ok) {
            alert('✅ Citizens Registry List successfully dispatched to channel!');
        } else {
            alert('❌ Failed to dispatch citizens list.');
        }
    } catch (err) {
        console.error("Export citizens error:", err);
        alert("❌ Connection error while dispatching citizens list.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Dispatch Citizens List';
    }
}

async function sendReportToAccountingChannel(blob, filename, fileType) {
    try {
        const token = localStorage.getItem('staffToken');
        const formData = new FormData();
        formData.append('report', blob, filename);
        formData.append('fileType', fileType);
        formData.append('dispatchedBy', localStorage.getItem('username') || 'Admin');
        formData.append('filter', currentSalarySubView);

        const res = await fetch(`${API_BASE_URL}/api/salary/notify-accounting`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (res.ok) {
            alert(`✅ ${fileType.toUpperCase()} Salary Report successfully dispatched to the accounting channel!`);
        } else {
            const errData = await res.json().catch(() => ({}));
            alert(`❌ Failed to dispatch report to accounting: ${errData.message || 'Server error'}`);
        }
    } catch (err) {
        console.error("Accounting notification dispatch error:", err);
        alert("❌ Network error while dispatching report to accounting channel.");
    }
}

async function exportSalaryCSV() {
    const btn = document.getElementById('btn-export-csv');
    const data = getExportSalaryData();
    if (!data.length) {
        alert("⚠ No salary data available to export.");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dispatching CSV...';

    try {
        const headers = [
            "Badge/ID",
            "Department",
            "Title / Rank",
            "Name",
            "Base Salary",
            "Full Weekly Cap",
            "Pro-Rated Base",
            "Incentives",
            "Total Weekly Payable",
            "Payment Status"
        ];

        const csvRows = [headers.join(',')];

        let sumBase = 0;
        let sumFullWk = 0;
        let sumProRated = 0;
        let sumInc = 0;
        let sumTotalWk = 0;

        data.forEach(item => {
            sumBase += item.baseSalary;
            sumFullWk += item.fullWeekly;
            sumProRated += item.proRatedBase;
            sumInc += item.incentives;
            sumTotalWk += item.totalWeekly;

            const row = [
                `"${item.badge}"`,
                `"${item.department}"`,
                `"${item.title.replace(/"/g, '""')}"`,
                `"${item.name.replace(/"/g, '""')}"`,
                item.baseSalary.toFixed(2),
                item.fullWeekly.toFixed(2),
                item.proRatedBase.toFixed(2),
                item.incentives.toFixed(2),
                item.totalWeekly.toFixed(2),
                `"${item.status}"`
            ];
            csvRows.push(row.join(','));
        });

        csvRows.push('');

        const summaryRow = [
            `"TOTALS (${data.length} Personnel)"`,
            `""`,
            `""`,
            `""`,
            sumBase.toFixed(2),
            sumFullWk.toFixed(2),
            sumProRated.toFixed(2),
            sumInc.toFixed(2),
            sumTotalWk.toFixed(2),
            `""`
        ];
        csvRows.push(summaryRow.join(','));

        const csvString = csvRows.join('\r\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `RegionIX_Salary_Report_${currentSalarySubView}_${timestamp}.csv`;

        await sendReportToAccountingChannel(blob, filename, 'csv');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Dispatch CSV to Accounting';
    }
}

async function exportSalaryPDF() {
    const btn = document.getElementById('btn-export-pdf');
    const data = getExportSalaryData();
    if (!data.length) {
        alert("⚠️ No salary data available to export.");
        return;
    }

    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert("❌ PDF library failed to load. Please check your internet connection.");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dispatching PDF...';

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

        doc.setFontSize(15);
        doc.setTextColor(37, 99, 235);
        doc.text("REGION IX - SALARY DISBURSEMENT REPORT", 14, 14);

        doc.setFontSize(9);
        doc.setTextColor(100);
        const subTitle = `Filter: ${currentSalarySubView} | Generated On: ${new Date().toLocaleString()} | Exported By: ${localStorage.getItem('username') || 'Admin'}`;
        doc.text(subTitle, 14, 20);

        const tableHeaders = [["Badge/ID", "Dept", "Title / Rank", "Name", "Base Salary", "Weekly Cap", "Pro-Rated Base", "Incentives", "Total Payable", "Status"]];
        
        const tableData = data.map(item => [
            item.badge,
            item.department,
            item.title,
            item.name,
            formatCurrency(item.baseSalary),
            formatCurrency(item.fullWeekly),
            formatCurrency(item.proRatedBase),
            formatCurrency(item.incentives),
            formatCurrency(item.totalWeekly),
            item.status
        ]);

        doc.autoTable({
            head: tableHeaders,
            body: tableData,
            startY: 24,
            margin: { left: 14, right: 14 },
            theme: 'grid',
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
            alternateRowStyles: { fillColor: [240, 243, 248] },
            styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 22 },
                1: { cellWidth: 14, halign: 'center' },
                2: { cellWidth: 42 },
                3: { cellWidth: 30 },
                4: { cellWidth: 27, halign: 'right' },
                5: { cellWidth: 27, halign: 'right' },
                6: { cellWidth: 28, halign: 'right' },
                7: { cellWidth: 24, halign: 'right' },
                8: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
                9: { cellWidth: 22, halign: 'center' }
            }
        });

        const totalDisbursed = data.filter(d => d.status === 'PAID').reduce((sum, d) => sum + d.totalWeekly, 0);
        const totalUnpaid = data.filter(d => d.status !== 'PAID').reduce((sum, d) => sum + d.totalWeekly, 0);
        const totalGross = totalDisbursed + totalUnpaid;

        let finalY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 8 : 170;
        if (finalY > 185) {
            doc.addPage();
            finalY = 20;
        }

        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.setFont(undefined, 'bold');
        doc.text(`Total Gross Payroll: ${formatCurrency(totalGross)}`, 14, finalY);
        doc.text(`Total Disbursed (Paid): ${formatCurrency(totalDisbursed)}`, 105, finalY);
        doc.text(`Remaining Unpaid Balance: ${formatCurrency(totalUnpaid)}`, 190, finalY);

        const blob = doc.output('blob');
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `RegionIX_Salary_Report_${currentSalarySubView}_${timestamp}.pdf`;

        await sendReportToAccountingChannel(blob, filename, 'pdf');
    } catch (err) {
        console.error("PDF Export Error:", err);
        alert("❌ Failed to generate PDF report. Check console for details.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Dispatch PDF to Accounting';
    }
}

function initChartIfNeeded() {
    const canvas = document.getElementById('dutyChart');
    if (!canvas) return;

    if (dutyChart) {
        dutyChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    dutyChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['PNP Officers', 'Government'],
            datasets: [{
                data: [0, 0],
                backgroundColor: ['#2563eb', '#10b981'],
                borderWidth: 3,
                borderColor: '#131b2e'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 12 }, padding: 16, usePointStyle: true } }
            },
            cutout: '72%'
        }
    });
}

function setNoWorkSubView(view) {
    currentNoWorkSubView = view;
    const btnAll = document.getElementById('btn-nowork-all');
    const btnPnp = document.getElementById('btn-nowork-pnp');
    const btnGov = document.getElementById('btn-nowork-gov');

    if (btnAll) btnAll.classList.toggle('active', view === 'ALL');
    if (btnPnp) btnPnp.classList.toggle('active', view === 'PNP');
    if (btnGov) btnGov.classList.toggle('active', view === 'GOV');

    const pnpCard = document.getElementById('nowork-card-pnp');
    const govCard = document.getElementById('nowork-card-gov');

    if (view === 'PNP') {
        if (pnpCard) pnpCard.style.display = 'block';
        if (govCard) govCard.style.display = 'none';
    } else if (view === 'GOV') {
        if (pnpCard) pnpCard.style.display = 'none';
        if (govCard) govCard.style.display = 'block';
    } else {
        if (pnpCard) pnpCard.style.display = 'block';
        if (govCard) govCard.style.display = 'block';
    }

    loadNoWorkNoPayTab();
}

async function loadNoWorkNoPayTab() {
    const tbodyPnp = document.getElementById('nowork-pnp-table-body');
    const tbodyGov = document.getElementById('nowork-gov-table-body');

    if (tbodyPnp) tbodyPnp.innerHTML = '<tr><td colspan="8">Loading PNP attendance records...</td></tr>';
    if (tbodyGov) tbodyGov.innerHTML = '<tr><td colspan="8">Loading Government attendance records...</td></tr>';

    try {
        const res = await apiFetch('/api/salary');
        if (!res.ok) throw new Error('Failed to fetch salary data');

        const salaries = await res.json() || [];

        const pnpSalaries = salaries.filter(item => {
            const dept = (item.department || (item.badge_id && String(item.badge_id).startsWith('GO') ? 'GOV' : 'PNP')).toUpperCase();
            return dept === 'PNP';
        }).sort((a, b) => compareIDs(a.badge_id || a.badgeId || a.id, b.badge_id || b.badgeId || b.id));

        const govSalaries = salaries.filter(item => {
            const dept = (item.department || (item.badge_id && String(item.badge_id).startsWith('GO') ? 'GOV' : 'PNP')).toUpperCase();
            return dept === 'GOV';
        }).sort((a, b) => compareIDs(a.badge_id || a.badgeId || a.id, b.badge_id || b.badgeId || b.id));

        let activeCount = 0;
        let zeroCount = 0;
        let totalPayrollPool = 0;

        const renderRows = (list) => {
            if (!list.length) return '<tr><td colspan="8">No personnel records found.</td></tr>';
            return list.map(item => {
                const days = item.daysAttended || item.days_attended || (item.days !== undefined ? item.days : 0);
                const baseMonthly = parseCurrency(item.baseSalary || item.salary);
                const fullWeekly = parseCurrency(item.weekly || item.weeklySalary) || (baseMonthly / 4.0);
                const isGen = (item.title || item.rank || '').toLowerCase() === 'police general';
                const dailyRate = fullWeekly / 7.0;
                const earnedBase = isGen ? fullWeekly : dailyRate * Math.min(7, days);
                const incentives = parseCurrency(item.incentives);
                const totalPayable = earnedBase + incentives;

                const deptName = (item.department || (item.badge_id && String(item.badge_id).startsWith('GO') ? 'GOV' : 'PNP')).toUpperCase();
                if (currentNoWorkSubView === 'ALL' || currentNoWorkSubView === deptName) {
                    totalPayrollPool += totalPayable;
                    if (days > 0 || isGen) activeCount++;
                    else zeroCount++;
                }

                let dutyBadge = '';
                if (isGen) {
                    dutyBadge = '<span class="duty-badge completed"><i class="fa-solid fa-star"></i> EXEMPT (100%)</span>';
                } else if (days >= 7) {
                    dutyBadge = '<span class="duty-badge completed"><i class="fa-solid fa-circle-check"></i> COMPLETED (7/7)</span>';
                } else if (days > 0) {
                    dutyBadge = `<span class="duty-badge partial"><i class="fa-solid fa-clock"></i> IN PROGRESS (${days}/7)</span>`;
                } else {
                    dutyBadge = '<span class="duty-badge zero"><i class="fa-solid fa-circle-xmark"></i> NO DUTY (0/7)</span>';
                }

                const rawKey = item.badge_id || item.badgeId || item.id || '';

                return `
                    <tr>
                        <td><code>${escapeHTML(rawKey)}</code></td>
                        <td><strong>${escapeHTML(item.name || 'N/A')}</strong></td>
                        <td>${escapeHTML(item.title || item.rank || item.position || 'N/A')}</td>
                        <td>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <strong>${isGen ? 'Exempt' : `${days} / 7 Days`}</strong>
                                <progress value="${isGen ? 7 : days}" max="7" style="width: 60px;"></progress>
                            </div>
                        </td>
                        <td>${dutyBadge}</td>
                        <td><strong style="color: var(--accent-green);">${formatCurrency(earnedBase)}</strong></td>
                        <td>${formatCurrency(incentives)}</td>
                        <td><strong>${formatCurrency(totalPayable)}</strong></td>
                    </tr>
                `;
            }).join('');
        };

        if (tbodyPnp) tbodyPnp.innerHTML = renderRows(pnpSalaries);
        if (tbodyGov) tbodyGov.innerHTML = renderRows(govSalaries);

        if (currentNoWorkSubView === 'PNP') {
            document.getElementById('nowork-lbl-active').innerText = 'Active Officers (1+ Days)';
            document.getElementById('nowork-lbl-inactive').innerText = 'Inactive Officers (0 Days / PHP 0)';
            document.getElementById('nowork-lbl-payroll').innerText = 'PNP Total Payroll Due';
        } else if (currentNoWorkSubView === 'GOV') {
            document.getElementById('nowork-lbl-active').innerText = 'Active Gov Staff (1+ Days)';
            document.getElementById('nowork-lbl-inactive').innerText = 'Inactive Gov Staff (0 Days / PHP 0)';
            document.getElementById('nowork-lbl-payroll').innerText = 'Gov Total Payroll Due';
        } else {
            document.getElementById('nowork-lbl-active').innerText = 'Active Personnel (1+ Days)';
            document.getElementById('nowork-lbl-inactive').innerText = 'Inactive Personnel (0 Days / PHP 0)';
            document.getElementById('nowork-lbl-payroll').innerText = 'Total Combined Payroll Due';
        }

        document.getElementById('nowork-active-count').innerText = activeCount;
        document.getElementById('nowork-zero-count').innerText = zeroCount;
        document.getElementById('nowork-total-payroll').innerText = formatCurrency(totalPayrollPool);

    } catch (err) {
        console.error('Error loading Attendance Audit tab:', err);
        if (tbodyPnp) tbodyPnp.innerHTML = '<tr><td colspan="8" style="color:#ef4444;">Failed to load attendance records.</td></tr>';
        if (tbodyGov) tbodyGov.innerHTML = '<tr><td colspan="8" style="color:#ef4444;">Failed to load attendance records.</td></tr>';
    }
}

async function loadSalaryPersonnelDropdown() {
    const select = document.getElementById('sal-personnel-select');
    if (!select) return;

    const isGov = currentSalarySubView === 'GOV';
    const endpoint = isGov ? '/api/government' : '/api/officers';

    select.innerHTML = '<option value="">⏳ Loading personnel directory...</option>';

    try {
        const res = await apiFetch(endpoint);
        if (res.ok) {
            const rawList = await res.json();
            
            salaryPersonnelCache = (rawList || []);

            salaryPersonnelCache.sort((a, b) => {
                const idA = isGov ? (a.id || '') : (a.badge || '');
                const idB = isGov ? (b.id || '') : (b.badge || '');
                return compareIDs(idA, idB);
            });

            select.innerHTML = '<option value="">-- Select Personnel to Auto-Fill --</option>';

            if (!salaryPersonnelCache.length) {
                select.innerHTML = '<option value="">No personnel found in directory</option>';
                return;
            }

            salaryPersonnelCache.forEach((p, idx) => {
                const idVal = escapeHTML(isGov ? p.id : p.badge);
                const titleVal = escapeHTML(isGov ? p.position : p.rank);
                const nameVal = escapeHTML(p.name || 'Unnamed Personnel');
                select.innerHTML += `<option value="${idx}">[${idVal}] ${nameVal} (${titleVal})</option>`;
            });
        }
    } catch (e) {
        select.innerHTML = '<option value="">❌ Failed to load personnel</option>';
    }
}

function onSalaryPersonnelSelect() {
    const select = document.getElementById('sal-personnel-select');
    const idx = select.value;

    const badgeInput = document.getElementById('sal-badge');
    const titleInput = document.getElementById('sal-title');
    const nameInput = document.getElementById('sal-name');
    const baseInput = document.getElementById('sal-base');
    const incInput = document.getElementById('sal-incentives');

    if (idx === '' || !salaryPersonnelCache[idx]) {
        badgeInput.value = '';
        titleInput.value = '';
        nameInput.value = '';
        baseInput.value = '';
        incInput.value = '0.00';

        badgeInput.readOnly = false;
        titleInput.readOnly = false;
        nameInput.readOnly = false;
        return;
    }

    const person = salaryPersonnelCache[idx];
    const isGov = currentSalarySubView === 'GOV';

    const badgeVal = (isGov ? person.id : person.badge) || '';
    const titleVal = (isGov ? person.position : person.rank) || '';
    const nameVal = person.name || '';

    badgeInput.value = badgeVal;
    titleInput.value = titleVal;
    nameInput.value = nameVal;

    badgeInput.readOnly = true;
    titleInput.readOnly = true;
    nameInput.readOnly = true;

    const existingRecord = rawSalariesCache.find(s => 
        String(s.badge_id || s.badgeId || s.id || '') === String(badgeVal)
    );

    if (existingRecord) {
        baseInput.value = parseCurrency(existingRecord.salary || existingRecord.baseSalary).toFixed(2);
        incInput.value = parseCurrency(existingRecord.incentives).toFixed(2);
        return;
    }

    const matchedKey = SALARY_GRADES[titleVal] ? titleVal :
        Object.keys(SALARY_GRADES).find(k => k.toLowerCase() === titleVal.toLowerCase());

    if (matchedKey && SALARY_GRADES[matchedKey]) {
        baseInput.value = parseCurrency(SALARY_GRADES[matchedKey].baseSalary).toFixed(2);
        incInput.value = parseCurrency(SALARY_GRADES[matchedKey].incentives).toFixed(2);
    } else {
        baseInput.value = parseCurrency(person.baseSalary || person.salary || 0).toFixed(2);
        incInput.value = parseCurrency(person.incentives || 0).toFixed(2);
    }
}

function setSalarySubView(view) {
    currentSalarySubView = view;
    
    document.getElementById('btn-sal-tab-all').classList.toggle('active', view === 'ALL');
    document.getElementById('btn-sal-tab-pnp').classList.toggle('active', view === 'PNP');
    document.getElementById('btn-sal-tab-gov').classList.toggle('active', view === 'GOV');

    const pnpCard = document.getElementById('sal-card-pnp');
    const govCard = document.getElementById('sal-card-gov');
    const grandCard = document.getElementById('card-grand-summary');
    const addCard = document.getElementById('card-add-salary');
    const deptSelect = document.getElementById('sal-dept');

    const role = (localStorage.getItem('userRole') || 'GUEST').toUpperCase();
    const status = (localStorage.getItem('userStatus') || '').toUpperCase();
    const canManage = (role === 'SUPER_ADMIN' || role === 'ADMIN') && status === 'APPROVED';

    if (view === 'PNP') {
        pnpCard.style.display = 'block';
        govCard.style.display = 'none';
        grandCard.style.display = 'none';

        if (addCard) addCard.style.display = canManage ? 'block' : 'none';
        if (deptSelect) {
            deptSelect.value = 'PNP';
            deptSelect.disabled = true;
        }
        loadSalaryPersonnelDropdown();
    } else if (view === 'GOV') {
        pnpCard.style.display = 'none';
        govCard.style.display = 'block';
        grandCard.style.display = 'none';

        if (addCard) addCard.style.display = canManage ? 'block' : 'none';
        if (deptSelect) {
            deptSelect.value = 'GOV';
            deptSelect.disabled = true;
        }
        loadSalaryPersonnelDropdown();
    } else {
        pnpCard.style.display = 'block';
        govCard.style.display = 'block';
        grandCard.style.display = 'block';

        if (addCard) addCard.style.display = 'none';
        if (deptSelect) {
            deptSelect.disabled = false;
        }
    }

    renderSalaryTables();
}

async function fetchSalaryData() {
    try {
        const res = await apiFetch('/api/salary');
        if (res.ok) {
            rawSalariesCache = await res.json();
            renderSalaryTables();
        }
    } catch (e) {
        document.getElementById('pnp-salary-table-body').innerHTML = '<tr><td colspan="10" style="color:#ef4444;">Failed to load server data.</td></tr>';
        document.getElementById('gov-salary-table-body').innerHTML = '<tr><td colspan="10" style="color:#ef4444;">Failed to load server data.</td></tr>';
    }
}

async function fetchTreasuryData() {
    try {
        const res = await apiFetch('/api/salary/treasury');
        if (res.ok) {
            const data = await res.json();
            const input = document.getElementById('treasury-amount-input');
            if (input && data.amount !== undefined) {
                input.value = parseCurrency(data.amount).toFixed(2);
            }
        }
    } catch (e) {
        console.warn("Failed to fetch treasury data:", e);
    }
}

async function updateTreasuryBalance() {
    const input = document.getElementById('treasury-amount-input');
    const msgDiv = document.getElementById('treasury-status-msg');
    const amount = parseCurrency(input.value);

    if (amount < 0) {
        msgDiv.style.color = '#ef4444';
        msgDiv.innerText = '❌ Treasury balance cannot be negative.';
        return;
    }

    msgDiv.style.color = '#60a5fa';
    msgDiv.innerText = '⏳ Updating Treasury balance...';

    try {
        const res = await apiFetch('/api/salary/treasury', {
            method: 'POST',
            body: JSON.stringify({ amount: amount })
        });

        if (res.ok) {
            msgDiv.style.color = '#10b981';
            msgDiv.innerText = '✅ Treasury balance updated successfully!';
            fetchTreasuryData();
        } else {
            msgDiv.style.color = '#ef4444';
            msgDiv.innerText = '❌ Failed to update treasury balance.';
        }
    } catch (err) {
        msgDiv.style.color = '#ef4444';
        msgDiv.innerText = '❌ Network error updating treasury.';
    }
}

async function updateSalaryStatus(selectElement, recordKey, actionType) {
    const item = rawSalariesCache.find(s => String(s.badge_id || s.badgeId || s.id || '') === String(recordKey));

    if (!item) {
        alert("❌ Record not found in local cache.");
        return;
    }

    const previousStatus = (item.status || 'unpaid').toLowerCase();
    item.status = actionType;
    selectElement.className = `status-dropdown ${actionType}`;

    const currentUser = localStorage.getItem('username') || 'Admin';
    const dept = item.department || (item.badge_id && String(item.badge_id).startsWith('GO') ? 'GOV' : 'PNP');
    const badge = item.badge_id || item.badgeId || recordKey;
    const totalWkAmount = formatCurrency(item.computedTotalWk || parseCurrency(item.totalWk || item.totalPerWeek));

    const savePayload = {
        department: dept,
        title: item.title || '',
        name: item.name || '',
        badgeId: badge,
        baseSalary: parseCurrency(item.salary || item.baseSalary),
        incentives: parseCurrency(item.incentives),
        status: actionType,
        updatedBy: currentUser,
        timestamp: new Date().toISOString()
    };

    const auditPayload = {
        event: 'SALARY_STATUS_CHANGE',
        badgeId: badge,
        name: item.name || 'N/A',
        title: item.title || 'N/A',
        department: dept,
        previousStatus: previousStatus.toUpperCase(),
        newStatus: actionType.toUpperCase(),
        amount: totalWkAmount,
        updatedBy: currentUser,
        timestamp: new Date().toISOString()
    };

    try {
        const saveRes = await apiFetch('/api/salary/save', {
            method: 'POST',
            body: JSON.stringify(savePayload)
        });

        if (saveRes.ok) {
            apiFetch('/api/salary/webhook-audit', {
                method: 'POST',
                body: JSON.stringify(auditPayload)
            }).catch(auditErr => console.warn("Audit webhook dispatch warning:", auditErr));

            await fetchSalaryData();
        } else {
            const errData = await saveRes.json().catch(() => ({}));
            alert("❌ Failed to update status on server: " + (errData.message || "Unknown error"));
            await fetchSalaryData();
        }
    } catch (err) {
        console.error("Failed to sync salary action to server:", err);
        alert("❌ Connection error while processing salary action.");
        await fetchSalaryData();
    }
}

async function deleteSalaryRecord(badgeId) {
    if (!badgeId) {
        alert("❌ Invalid Badge / ID No.");
        return;
    }

    if (!confirm(`Are you sure you want to permanently delete the salary record for Badge / ID [${badgeId}]?`)) {
        return;
    }

    try {
        const res = await apiFetch('/api/salary/delete', {
            method: 'POST',
            body: JSON.stringify({ badgeId: String(badgeId) })
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && (data.status === 'success' || data.success)) {
            alert('✅ Salary record deleted successfully!');
            await fetchSalaryData();
        } else {
            alert(`❌ Failed to delete record: ${data.message || 'Unauthorized or unknown error'}`);
        }
    } catch (err) {
        console.error('Delete salary error:', err);
        alert('❌ Connection error while deleting salary record.');
    }
}

function renderSalaryTables() {
    const pnpTbody = document.getElementById('pnp-salary-table-body');
    const govTbody = document.getElementById('gov-salary-table-body');

    const role = (localStorage.getItem('userRole') || 'GUEST').toUpperCase();
    const status = (localStorage.getItem('userStatus') || '').toUpperCase();
    const canManageSalary = (role === 'SUPER_ADMIN' || role === 'ADMIN') && status === 'APPROVED';

    const thPnpStatus = document.getElementById('th-pnp-status');
    const thPnpActions = document.getElementById('th-pnp-actions');
    const thGovStatus = document.getElementById('th-gov-status');
    const thGovActions = document.getElementById('th-gov-actions');

    if (thPnpStatus) thPnpStatus.style.display = canManageSalary ? '' : 'none';
    if (thPnpActions) thPnpActions.style.display = canManageSalary ? '' : 'none';
    if (thGovStatus) thGovStatus.style.display = canManageSalary ? '' : 'none';
    if (thGovActions) thGovActions.style.display = canManageSalary ? '' : 'none';

    if (!rawSalariesCache || !rawSalariesCache.length) {
        pnpTbody.innerHTML = '<tr><td colspan="10">No salary records found.</td></tr>';
        govTbody.innerHTML = '<tr><td colspan="10">No salary records found.</td></tr>';
        return;
    }

    const pnpList = rawSalariesCache.filter(item => {
        const dept = item.department || (item.badge_id && String(item.badge_id).startsWith('GO') ? 'GOV' : 'PNP');
        return dept.toUpperCase() === 'PNP';
    }).sort((a, b) => compareIDs(a.badge_id || a.badgeId, b.badge_id || b.badgeId));

    const govList = rawSalariesCache.filter(item => {
        const dept = item.department || (item.badge_id && String(item.badge_id).startsWith('GO') ? 'GOV' : 'PNP');
        return dept.toUpperCase() === 'GOV';
    }).sort((a, b) => compareIDs(a.badge_id || a.badgeId, b.badge_id || b.badgeId));

    let pnpBase = 0, pnpInc = 0, pnpTotalWk = 0, pnpPaidWk = 0, pnpFullCapTotal = 0;
    pnpTbody.innerHTML = pnpList.length ? pnpList.map(s => {
        const b = parseCurrency(s.salary || s.baseSalary);
        const fullWk = b / 4.0;
        const days = s.daysAttended || s.days_attended || 0;
        const isGen = (s.title || '').toLowerCase() === 'police general';
        const proRatedBase = isGen ? fullWk : (fullWk / 7.0) * Math.min(7, days);
        const i = parseCurrency(s.incentives);
        const tw = proRatedBase + i;
        s.computedTotalWk = tw;

        const rawKey = s.badge_id || s.badgeId || s.id || '';
        const keyEscaped = escapeHTML(rawKey);
        const jsKey = escapeJsArg(rawKey);
        const statusVal = (s.status || 'unpaid').toLowerCase();

        pnpBase += b;
        pnpInc += i;
        pnpFullCapTotal += fullWk;
        pnpTotalWk += tw;

        if (statusVal === 'paid') {
            pnpPaidWk += tw;
        }

        const isPaid = statusVal === 'paid';
        const isInactive = statusVal === 'inactive';
        const isUnpaid = !isPaid && !isInactive;
        const dropdownClass = isPaid ? 'paid' : (isInactive ? 'inactive' : 'unpaid');

        const adminColumnsHtml = canManageSalary ? `
            <td>
                <select class="status-dropdown ${dropdownClass}" onchange="updateSalaryStatus(this, '${jsKey}', this.value)">
                    <option value="unpaid" ${isUnpaid ? 'selected' : ''}>No Salary / Unpaid</option>
                    <option value="paid" ${isPaid ? 'selected' : ''}>Mark as Paid</option>
                    <option value="inactive" ${isInactive ? 'selected' : ''}>Mark as Inactive (IA)</option>
                </select>
            </td>
            <td>
                <button class="btn-danger" onclick="deleteSalaryRecord('${jsKey}')">Delete</button>
            </td>
        ` : '';

        return `
            <tr>
                <td><code>${keyEscaped}</code></td>
                <td><strong>${escapeHTML(s.title)}</strong></td>
                <td>${escapeHTML(s.name)}</td>
                <td>${formatCurrency(b)}</td>
                <td>${formatCurrency(fullWk)}</td>
                <td><strong style="color: var(--accent-green);">${formatCurrency(proRatedBase)}</strong></td>
                <td>${formatCurrency(i)}</td>
                <td><strong>${formatCurrency(tw)}</strong></td>
                ${adminColumnsHtml}
            </tr>
        `;
    }).join('') : '<tr><td colspan="10">No salary records found.</td></tr>';

    const pnpUnpaidWk = Math.max(0, pnpTotalWk - pnpPaidWk);
    document.getElementById('pnp-sum-full-cap').innerText = formatCurrency(pnpFullCapTotal);
    document.getElementById('pnp-sum-total-wk').innerText = formatCurrency(pnpTotalWk);
    document.getElementById('pnp-sum-paid').innerText = formatCurrency(pnpPaidWk);
    document.getElementById('pnp-sum-unpaid').innerText = formatCurrency(pnpUnpaidWk);

    let govBase = 0, govInc = 0, govTotalWk = 0, govPaidWk = 0, govFullCapTotal = 0;
    govTbody.innerHTML = govList.length ? govList.map(s => {
        const b = parseCurrency(s.salary || s.baseSalary);
        const fullWk = parseCurrency(s.weekly || s.weeklySalary) || (b / 4.0);
        const days = s.daysAttended || s.days_attended || (s.days !== undefined ? s.days : 0);
        const proRatedBase = (fullWk / 7.0) * Math.min(7, days);
        const i = parseCurrency(s.incentives);
        const tw = proRatedBase + i;
        s.computedTotalWk = tw;

        const rawKey = s.badge_id || s.badgeId || s.id || '';
        const keyEscaped = escapeHTML(rawKey);
        const jsKey = escapeJsArg(rawKey);
        const statusVal = (s.status || 'unpaid').toLowerCase();

        govBase += b;
        govInc += i;
        govFullCapTotal += fullWk;
        govTotalWk += tw;

        if (statusVal === 'paid') {
            govPaidWk += tw;
        }

        const isPaid = statusVal === 'paid';
        const isInactive = statusVal === 'inactive';
        const isUnpaid = !isPaid && !isInactive;
        const dropdownClass = isPaid ? 'paid' : (isInactive ? 'inactive' : 'unpaid');

        const adminColumnsHtml = canManageSalary ? `
            <td>
                <select class="status-dropdown ${dropdownClass}" onchange="updateSalaryStatus(this, '${jsKey}', this.value)">
                    <option value="unpaid" ${isUnpaid ? 'selected' : ''}>No Salary / Unpaid</option>
                    <option value="paid" ${isPaid ? 'selected' : ''}>Mark as Paid</option>
                    <option value="inactive" ${isInactive ? 'selected' : ''}>Mark as Inactive (IA)</option>
                </select>
            </td>
            <td>
                <button class="btn-danger" onclick="deleteSalaryRecord('${jsKey}')">Delete</button>
            </td>
        ` : '';

        return `
            <tr>
                <td><code>${keyEscaped}</code></td>
                <td><strong>${escapeHTML(s.title)}</strong></td>
                <td>${escapeHTML(s.name)}</td>
                <td>${formatCurrency(b)}</td>
                <td>${formatCurrency(fullWk)}</td>
                <td><strong style="color: var(--accent-green);">${formatCurrency(proRatedBase)}</strong></td>
                <td>${formatCurrency(i)}</td>
                <td><strong>${formatCurrency(tw)}</strong></td>
                ${adminColumnsHtml}
            </tr>
        `;
    }).join('') : '<tr><td colspan="10">No salary records found.</td></tr>';

    const govUnpaidWk = Math.max(0, govTotalWk - govPaidWk);
    document.getElementById('gov-sum-full-cap').innerText = formatCurrency(govFullCapTotal);
    document.getElementById('gov-sum-total-wk').innerText = formatCurrency(govTotalWk);
    document.getElementById('gov-sum-paid').innerText = formatCurrency(govPaidWk);
    document.getElementById('gov-sum-unpaid').innerText = formatCurrency(govUnpaidWk);

    const grandFullCap = pnpFullCapTotal + govFullCapTotal;
    const grandGross = pnpTotalWk + govTotalWk;
    const grandPaid = pnpPaidWk + govPaidWk;
    const grandUnpaid = Math.max(0, grandGross - grandPaid);

    document.getElementById('grand-full-cap-total').innerText = formatCurrency(grandFullCap);
    document.getElementById('grand-gross-total').innerText = formatCurrency(grandGross);
    document.getElementById('grand-paid-total').innerText = formatCurrency(grandPaid);
    document.getElementById('grand-unpaid-total').innerText = formatCurrency(grandUnpaid);

    if (currentSalarySubView === 'PNP') {
        document.getElementById('stat-lbl-base').innerText = 'Base Salary (PNP)';
        document.getElementById('stat-lbl-inc').innerText = 'Incentives (PNP)';
        document.getElementById('stat-lbl-weekly').innerText = 'Remaining Unpaid (PNP)';
        document.getElementById('stat-total-base').innerText = formatCurrency(pnpBase);
        document.getElementById('stat-total-incentives').innerText = formatCurrency(pnpInc);
        document.getElementById('stat-total-weekly').innerText = formatCurrency(pnpUnpaidWk);
    } else if (currentSalarySubView === 'GOV') {
        document.getElementById('stat-lbl-base').innerText = 'Base Salary (Gov)';
        document.getElementById('stat-lbl-inc').innerText = 'Incentives (Gov)';
        document.getElementById('stat-lbl-weekly').innerText = 'Remaining Unpaid (Gov)';
        document.getElementById('stat-total-base').innerText = formatCurrency(govBase);
        document.getElementById('stat-total-incentives').innerText = formatCurrency(govInc);
        document.getElementById('stat-total-weekly').innerText = formatCurrency(govUnpaidWk);
    } else {
        document.getElementById('stat-lbl-base').innerText = 'Base Salary (Combined)';
        document.getElementById('stat-lbl-inc').innerText = 'Incentives (Combined)';
        document.getElementById('stat-lbl-weekly').innerText = 'Remaining Unpaid (Combined)';
        document.getElementById('stat-total-base').innerText = formatCurrency(pnpBase + govBase);
        document.getElementById('stat-total-incentives').innerText = formatCurrency(pnpInc + govInc);
        document.getElementById('stat-total-weekly').innerText = formatCurrency(grandUnpaid);
    }
}

async function handleSaveSalary(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-salary');
    const msgDiv = document.getElementById('sal-status-msg');

    const dept = document.getElementById('sal-dept').value;
    const title = document.getElementById('sal-title').value.trim();
    const name = document.getElementById('sal-name').value.trim();
    const badgeId = document.getElementById('sal-badge').value.trim();
    const baseSalary = parseCurrency(document.getElementById('sal-base').value);
    const incentives = parseCurrency(document.getElementById('sal-incentives').value);

    if (baseSalary < 0 || incentives < 0) {
        msgDiv.style.color = '#ef4444';
        msgDiv.innerText = '❌ Base salary and incentives must be non-negative values.';
        return;
    }

    msgDiv.style.color = '#60a5fa';
    msgDiv.innerText = '⏳ Saving salary entry...';
    btn.disabled = true;

    try {
        const res = await apiFetch('/api/salary/save', {
            method: 'POST',
            body: JSON.stringify({
                department: dept,
                title: title,
                name: name,
                badgeId: badgeId,
                baseSalary: baseSalary,
                incentives: incentives,
                status: 'unpaid'
            })
        });

        const result = await res.json();
        if (res.ok && result.status === 'success') {
            msgDiv.style.color = '#10b981';
            msgDiv.innerText = '✅ Salary record saved successfully!';
            document.getElementById('form-salary').reset();

            const deptSelect = document.getElementById('sal-dept');
            if (currentSalarySubView === 'PNP') {
                deptSelect.value = 'PNP';
                deptSelect.disabled = true;
            } else if (currentSalarySubView === 'GOV') {
                deptSelect.value = 'GOV';
                deptSelect.disabled = true;
            }

            loadSalaryPersonnelDropdown();
            fetchSalaryData();
        } else {
            msgDiv.style.color = '#ef4444';
            msgDiv.innerText = `❌ Error: ${result.message || 'Unauthorized action'}`;
        }
    } catch (err) {
        msgDiv.style.color = '#ef4444';
        msgDiv.innerText = '❌ Failed to connect to server.';
    } finally {
        btn.disabled = false;
    }
}

function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('staffToken');
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

async function apiFetch(endpoint, options = {}) {
    const headers = getAuthHeaders();
    options.headers = { ...headers, ...(options.headers || {}) };
    
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        
        if ((response.status === 401 || response.status === 403) && endpoint !== '/api/login' && endpoint !== '/api/register') {
            const cloned = response.clone();
            const data = await cloned.json().catch(() => ({}));
            
            if (data.message && data.message.includes("Super Admin access required")) {
                return response;
            }

            if (data.message && (data.message.includes("Invalid token") || data.message.includes("Unauthorized"))) {
                localStorage.clear();
                checkAuthState();
                alert("Session expired or invalid. Please sign in again.");
            }
        }
        return response;
    } catch (err) {
        throw err;
    }
}

function checkAuthState() {
    const token = localStorage.getItem('staffToken');
    const authScreen = document.getElementById('auth-screen');
    const appContainer = document.getElementById('app-container');

    if (token) {
        if (authScreen) authScreen.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';
        initChartIfNeeded();
        applyRolePermissions();
        fetchDashboardData();
        setSalarySubView('ALL');
        fetchSalaryData();
        fetchTreasuryData();
        if (!dashboardInterval) {
            dashboardInterval = setInterval(fetchDashboardData, 8000);
        }
    } else {
        if (authScreen) authScreen.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
        if (dashboardInterval) {
            clearInterval(dashboardInterval);
            dashboardInterval = null;
        }
    }
}

function switchAuthTab(tab) {
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
    
    const msg = document.getElementById('auth-status-msg');
    msg.innerText = '';
    msg.style.color = '';
}

async function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('login-username').value.trim();
    const p = document.getElementById('login-password').value.trim();
    const msg = document.getElementById('auth-status-msg');

    msg.style.color = '#60a5fa';
    msg.innerText = '⏳ Authenticating...';

    try {
        const res = await apiFetch('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username: u, password: p })
        });

        const data = await res.json();

        if (data.message && data.message.includes("API Server is Running")) {
            msg.style.color = '#ef4444';
            msg.innerText = '❌ API Route Error: Server misrouted endpoint to root.';
            return;
        }

        if (res.ok && (data.status === 'success' || data.success || !data.status || data.status === 'ok')) {
            localStorage.setItem('staffToken', data.token);
            localStorage.setItem('username', data.username);
            localStorage.setItem('userRole', data.role);
            localStorage.setItem('userDept', data.department);
            localStorage.setItem('userStatus', data.accountStatus);

            msg.style.color = '#10b981';
            msg.innerText = '✅ Authenticated successfully! Redirecting...';
            
            setTimeout(() => {
                window.location.href = 'hub.html';
            }, 500);
        } else {
            msg.style.color = '#ef4444';
            msg.innerText = `❌ ${data.message || 'Login failed.'}`;
        }
    } catch (err) {
        msg.style.color = '#ef4444';
        msg.innerText = '❌ Connection error.';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const btn = document.querySelector('#form-register button[type="submit"]');
    const u = document.getElementById('reg-username').value.trim();
    const p = document.getElementById('reg-password').value.trim();
    const b = document.getElementById('reg-badge').value.trim().toUpperCase();
    const msg = document.getElementById('auth-status-msg');

    msg.style.color = '#60a5fa';
    msg.innerText = '⏳ Submitting application...';
    if (btn) btn.disabled = true;

    try {
        const res = await apiFetch('/api/register', {
            method: 'POST',
            body: JSON.stringify({ 
                username: u, 
                password: p, 
                badgeId: b,
                badge_id: b 
            })
        });

        const data = await res.json();

        if (data.message && data.message.includes("API Server is Running")) {
            msg.style.color = '#ef4444';
            msg.innerText = '❌ API Route Error: Server misrouted endpoint to root.';
            return;
        }

        if (res.ok && (data.status === 'success' || data.success || !data.status || data.status === 'ok')) {
            msg.style.color = '#10b981';
            msg.innerText = `✅ ${data.message || 'Registered successfully! Redirecting to login...'}`;
            
            setTimeout(() => {
                switchAuthTab('login');
                document.getElementById('login-username').value = u;
                document.getElementById('login-password').value = p;
                msg.innerText = '';
            }, 1500);
        } else {
            msg.style.color = '#ef4444';
            msg.innerText = `❌ ${data.message || 'Registration failed.'}`;
        }
    } catch (err) {
        console.error("Registration error:", err);
        msg.style.color = '#ef4444';
        msg.innerText = '❌ Connection error. Ensure backend server is running.';
    } finally {
        if (btn) btn.disabled = false;
    }
}

function handleLogout() {
    localStorage.clear();
    checkAuthState();
    window.location.href = 'index.html';
}

function isPnpAdminOrSuperAdmin() {
    const role = (localStorage.getItem('userRole') || 'GUEST').toUpperCase();
    const dept = (localStorage.getItem('userDept') || 'NONE').toUpperCase();
    const status = (localStorage.getItem('userStatus') || 'NONE').toUpperCase();
    if (role === 'SUPER_ADMIN' && status === 'APPROVED') return true;
    return role === 'ADMIN' && dept === 'PNP' && status === 'APPROVED';
}

function isGovAdminOrSuperAdmin() {
    const role = (localStorage.getItem('userRole') || 'GUEST').toUpperCase();
    const dept = (localStorage.getItem('userDept') || 'NONE').toUpperCase();
    const status = (localStorage.getItem('userStatus') || 'NONE').toUpperCase();
    if (role === 'SUPER_ADMIN' && status === 'APPROVED') return true;
    return role === 'ADMIN' && dept === 'GOV' && status === 'APPROVED';
}

function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const targetSection = document.getElementById('view-' + viewName);
    if (targetSection) targetSection.style.display = 'block';

    const targetNav = document.getElementById('nav-' + viewName);
    if (targetNav) targetNav.classList.add('active');

    if (viewName === 'dashboard') {
        initChartIfNeeded();
        fetchDashboardData();
    }
    if (viewName === 'citizens') setCitizensSubView(currentCitizensSubView || 'ALL');
    if (viewName === 'officers') fetchOfficersData();
    if (viewName === 'government') fetchGovData();
    if (viewName === 'salary') {
        setSalarySubView(currentSalarySubView || 'ALL');
        fetchSalaryData();
        fetchTreasuryData();
    }
    if (viewName === 'nowork-nopay') {
        setNoWorkSubView(currentNoWorkSubView || 'ALL');
    }
    if (viewName === 'users') loadUserManagementTable();

    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('active')) {
        toggleMobileSidebar();
    }
}

function setCitizensSubView(subView) {
    currentCitizensSubView = subView;
    
    const btnAll = document.getElementById('btn-cit-all');
    const btnCiv = document.getElementById('btn-cit-civilian');
    const btnGov = document.getElementById('btn-cit-gov');
    const btnPnp = document.getElementById('btn-cit-pnp');

    if (btnAll) btnAll.classList.toggle('active', subView === 'ALL');
    if (btnCiv) btnCiv.classList.toggle('active', subView === 'CIVILIAN');
    if (btnGov) btnGov.classList.toggle('active', subView === 'GOV');
    if (btnPnp) btnPnp.classList.toggle('active', subView === 'PNP');

    const subTitles = {
        'ALL': 'Comprehensive Directory of Civilians, Government Officials, and PNP Personnel',
        'CIVILIAN': 'Comprehensive Directory of Pure Civilians',
        'GOV': 'Active Government Officials Roster',
        'PNP': 'Active PNP Personnel Roster'
    };

    const tableTitles = {
        'ALL': '<i class="fa-solid fa-address-book" style="color: var(--accent-blue);"></i> All Citizens Overview',
        'CIVILIAN': '<i class="fa-solid fa-user" style="color: var(--accent-blue);"></i> Registered Civilians Directory',
        'GOV': '<i class="fa-solid fa-landmark" style="color: var(--accent-green);"></i> Government Officials Directory',
        'PNP': '<i class="fa-solid fa-user-shield" style="color: var(--accent-blue);"></i> PNP Personnel Directory'
    };

    const subTitleEl = document.getElementById('citizens-sub-title');
    const tableTitleEl = document.getElementById('citizens-table-title');
    if (subTitleEl) subTitleEl.innerText = subTitles[subView] || '';
    if (tableTitleEl) tableTitleEl.innerHTML = tableTitles[subView] || '';

    const addCitizenCard = document.getElementById('card-add-citizen');
    const role = (localStorage.getItem('userRole') || 'GUEST').toUpperCase();
    const status = (localStorage.getItem('userStatus') || '').toUpperCase();
    const isFullAdmin = (role === 'SUPER_ADMIN' || role === 'ADMIN') && status === 'APPROVED';

    if (addCitizenCard) {
        addCitizenCard.style.display = (subView === 'ALL' || subView === 'CIVILIAN') && isFullAdmin ? 'block' : 'none';
    }

    loadCitizensData();
}

async function handleAddCitizen(e) {
    e.preventDefault();
    const nameInput = document.getElementById('add-citizen-name');
    const msgDiv = document.getElementById('add-citizen-msg');

    const name = nameInput.value.trim();

    msgDiv.style.color = '#60a5fa';
    msgDiv.innerText = '⏳ Registering civilian & notifying channel...';

    try {
        const res = await apiFetch('/api/citizens/add', {
            method: 'POST',
            body: JSON.stringify({ name: name, title: 'Civilian', classification: 'Civilian' })
        });
        const result = await res.json().catch(() => ({}));

        if (res.ok && (result.status === 'success' || result.success || result.id)) {
            apiFetch('/api/citizens/notify-channel', {
                method: 'POST',
                body: JSON.stringify({ name: name, registeredBy: localStorage.getItem('username') || 'Admin' })
            }).catch(err => console.warn("Citizen channel notification dispatch warning:", err));

            msgDiv.style.color = '#10b981';
            msgDiv.innerText = `✅ Successfully registered civilian ${name} and notified channel!`;
            nameInput.value = '';
            loadCitizensData();
            fetchDashboardData();
        } else {
            msgDiv.style.color = '#ef4444';
            msgDiv.innerText = `❌ Error: ${result.message || 'Failed to register civilian.'}`;
        }
    } catch (err) {
        console.error("Add citizen error:", err);
        msgDiv.style.color = '#ef4444';
        msgDiv.innerText = '❌ Network error connecting to API server.';
    }
}

async function deleteCitizenRecord(id) {
    if (!confirm(`Are you sure you want to delete civilian record [${id}]?`)) return;

    try {
        const res = await apiFetch('/api/citizens/delete', {
            method: 'POST',
            body: JSON.stringify({ id: String(id) })
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && (data.status === 'success' || data.success)) {
            alert('✅ Civilian record deleted successfully!');
            loadCitizensData();
            fetchDashboardData();
        } else {
            alert(`❌ Failed to delete civilian: ${data.message || 'Unauthorized or error'}`);
        }
    } catch (err) {
        console.error("Delete civilian error:", err);
        alert('❌ Network error while deleting civilian record.');
    }
}

async function loadCitizensData() {
    const tbody = document.getElementById('citizens-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5">Loading citizens directory...</td></tr>';

    const role = (localStorage.getItem('userRole') || 'GUEST').toUpperCase();
    const status = (localStorage.getItem('userStatus') || '').toUpperCase();
    const canManage = (role === 'SUPER_ADMIN' || role === 'ADMIN') && status === 'APPROVED';

    const thCitizensActions = document.getElementById('th-citizens-actions');
    if (thCitizensActions) thCitizensActions.style.display = canManage ? '' : 'none';

    try {
        const [citRes, govRes, pnpRes] = await Promise.all([
            apiFetch('/api/citizens').catch(() => ({ ok: false })),
            apiFetch('/api/government').catch(() => ({ ok: false })),
            apiFetch('/api/officers').catch(() => ({ ok: false }))
        ]);

        let civilians = [];
        let govOfficials = [];
        let pnpOfficers = [];

        if (citRes.ok) civilians = await citRes.json() || [];
        if (govRes.ok) govOfficials = await govRes.json() || [];
        if (pnpRes.ok) pnpOfficers = await pnpRes.json() || [];

        let combinedList = [];

        civilians.forEach((c, index) => {
            let cid = c.id || c.badge || ('CIT-' + String(index + 1).padStart(4, '0'));
            if (!cid.startsWith('CIT-') && !cid.startsWith('GO-') && !cid.includes('-')) {
                cid = 'CIT-' + cid;
            }
            combinedList.push({
                id: cid,
                classification: 'Civilian',
                classificationBadgeClass: 'badge-ref',
                name: c.name || 'N/A',
                title: c.title || 'Civilian',
                isPureCivilian: true,
                rawId: c.id
            });
        });

        govOfficials.forEach(g => {
            combinedList.push({
                id: g.id || 'GO-0000',
                classification: 'Government Official',
                classificationBadgeClass: 'badge-gov',
                name: g.name || 'N/A',
                title: g.position || 'Government Official',
                isPureCivilian: false,
                rawId: g.id
            });
        });

        pnpOfficers.forEach(p => {
            combinedList.push({
                id: p.badge || '09-0000',
                classification: 'PNP Personnel',
                classificationBadgeClass: 'badge-pnp',
                name: p.name || 'N/A',
                title: p.rank || 'Officer',
                isPureCivilian: false,
                rawId: p.badge
            });
        });

        let filteredList = combinedList.filter(item => {
            if (currentCitizensSubView === 'CIVILIAN') return item.isPureCivilian;
            if (currentCitizensSubView === 'GOV') return item.classification === 'Government Official';
            if (currentCitizensSubView === 'PNP') return item.classification === 'PNP Personnel';
            return true;
        });

        if (!filteredList.length) {
            tbody.innerHTML = '<tr><td colspan="5">No records found for this filter.</td></tr>';
            return;
        }

        filteredList.sort((a, b) => compareIDs(a.id, b.id));

        tbody.innerHTML = filteredList.map(item => {
            const jsRawId = escapeJsArg(item.rawId || item.id);
            const canDeleteThis = canManage && item.isPureCivilian;
            const actionsTd = canManage ? `
                <td>
                    <div class="action-cell">
                        ${canDeleteThis ? `<button class="btn-danger" onclick="deleteCitizenRecord('${jsRawId}')">Delete</button>` : '<span style="color: var(--text-muted); font-size: 0.78rem;">Managed in Roster</span>'}
                    </div>
                </div>` : '';

            return `
                <tr>
                    <td><code>${escapeHTML(item.id)}</code></td>
                    <td><span class="${item.classificationBadgeClass}">${escapeHTML(item.classification)}</span></td>
                    <td><strong>${escapeHTML(item.name)}</strong></td>
                    <td>${escapeHTML(item.title)}</td>
                    ${actionsTd}
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error("Error loading citizens data:", err);
        tbody.innerHTML = '<tr><td colspan="5" style="color:#ef4444;">Failed to load citizens directory.</td></tr>';
    }
}

function applyRolePermissions() {
    const role = (localStorage.getItem('userRole') || 'GUEST').toUpperCase();
    const dept = (localStorage.getItem('userDept') || 'NONE').toUpperCase();
    const status = (localStorage.getItem('userStatus') || 'NONE').toUpperCase();
    const username = localStorage.getItem('username') || 'User';

    const usernameEl = document.getElementById('display-username');
    const roleEl = document.getElementById('display-role');
    if (usernameEl) usernameEl.innerText = username;
    if (roleEl) roleEl.innerText = `${role} (${dept})`;

    const navUsers = document.getElementById('nav-users');
    const navCitizens = document.getElementById('nav-citizens');
    const navOfficers = document.getElementById('nav-officers');
    const navGovernment = document.getElementById('nav-government');

    if (navUsers) navUsers.style.display = 'none';
    if (navCitizens) navCitizens.style.display = 'flex';
    if (navOfficers) navOfficers.style.display = 'flex';
    if (navGovernment) navGovernment.style.display = 'flex';

    const cardAddOfficer = document.getElementById('card-add-officer');
    const cardAddGov = document.getElementById('card-add-gov');
    if (cardAddOfficer) cardAddOfficer.style.display = 'none';
    if (cardAddGov) cardAddGov.style.display = 'none';

    const addCitizenCard = document.getElementById('card-add-citizen');
    if (addCitizenCard) {
        const isFullAdmin = (role === 'SUPER_ADMIN' || role === 'ADMIN') && status === 'APPROVED';
        addCitizenCard.style.display = isFullAdmin && (currentCitizensSubView === 'ALL' || currentCitizensSubView === 'CIVILIAN') ? 'block' : 'none';
    }

    const treasuryCard = document.getElementById('card-treasury-control');
    if (treasuryCard) treasuryCard.style.display = 'none';

    const btnCsv = document.getElementById('btn-export-csv');
    const btnPdf = document.getElementById('btn-export-pdf');
    const btnReport = document.getElementById('triggerDailyReportBtn');
    const btnCitizensDispatch = document.getElementById('btn-export-citizens');

    const isFullAdmin = (role === 'SUPER_ADMIN' || role === 'ADMIN') && status === 'APPROVED';

    if (btnCsv) btnCsv.style.display = isFullAdmin ? 'inline-block' : 'none';
    if (btnPdf) btnPdf.style.display = isFullAdmin ? 'inline-block' : 'none';
    if (btnReport) btnReport.style.display = isFullAdmin ? 'inline-block' : 'none';
    if (btnCitizensDispatch) btnCitizensDispatch.style.display = isFullAdmin ? 'inline-block' : 'none';

    if (status !== 'APPROVED' && role !== 'SUPER_ADMIN') {
        return;
    }

    if (role === 'SUPER_ADMIN') {
        if (navUsers) navUsers.style.display = 'flex';
        if (cardAddOfficer) cardAddOfficer.style.display = 'block';
        if (cardAddGov) cardAddGov.style.display = 'block';
        if (treasuryCard) treasuryCard.style.display = 'block';
        return;
    }

    if (role === 'ADMIN') {
        if (treasuryCard) treasuryCard.style.display = 'block';
        if (dept === 'GOV') {
            if (cardAddGov) cardAddGov.style.display = 'block';
        } else if (dept === 'PNP') {
            if (cardAddOfficer) cardAddOfficer.style.display = 'block';
        }
    }
}

async function loadUserManagementTable() {
    const tbody = document.getElementById('user-management-table-body');
    if (!tbody) return;
    try {
        const res = await apiFetch('/api/admin/pending-users');
        if (res.ok) {
            const rawData = await res.json();
            const users = Array.isArray(rawData) ? rawData : (rawData.users || rawData.data || []);

            if (!users.length) {
                tbody.innerHTML = '<tr><td colspan="6">No registered accounts found.</td></tr>';
                return;
            }

            users.sort((a, b) => compareIDs(a.badgeId || a.badge_id, b.badgeId || b.badge_id));

            tbody.innerHTML = users.map(u => {
                const safeUserId = escapeJsArg(u.id || u._id || u.userId);
                const badgeNo = u.badgeId || u.badge_id || u.badge || 'N/A';
                const department = u.department || u.dept || 'N/A';
                const role = (u.role || u.userRole || 'MEMBER').toUpperCase();
                const accountStatus = (u.status || u.accountStatus || 'PENDING').toUpperCase();

                let actionButtons = '';

                if (accountStatus === 'PENDING') {
                    actionButtons = `
                        <button class="btn-success" onclick="updateAccountRole('${safeUserId}', 'ADMIN', 'APPROVED')">Approve Admin</button>
                        <button class="btn-primary" onclick="updateAccountRole('${safeUserId}', 'MEMBER', 'APPROVED')">Approve Member</button>
                        <button class="btn-warning" onclick="updateAccountRole('${safeUserId}', 'MEMBER', 'REJECTED')">Reject</button>
                    `;
                } else {
                    if (role === 'ADMIN') {
                        actionButtons += `<button class="btn-primary" onclick="updateAccountRole('${safeUserId}', 'MEMBER', 'APPROVED')">Set as Regular</button>`;
                    } else {
                        actionButtons += `<button class="btn-success" onclick="updateAccountRole('${safeUserId}', 'ADMIN', 'APPROVED')">Make Admin</button>`;
                    }
                }

                actionButtons += `<button class="btn-danger" onclick="deleteUserAccount('${safeUserId}')">Delete</button>`;

                return `
                    <tr>
                        <td><strong>${escapeHTML(u.username)}</strong></td>
                        <td><code>${escapeHTML(badgeNo)}</code></td>
                        <td>${escapeHTML(department)}</td>
                        <td>${escapeHTML(role)}</td>
                        <td><span class="badge-ref">${escapeHTML(accountStatus)}</span></td>
                        <td>
                            <div class="action-cell">
                                ${actionButtons}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444;">Failed to fetch users. Super Admin access required.</td></tr>';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444;">Failed to fetch users. Connection error.</td></tr>';
    }
}

async function updateAccountRole(userId, role, status) {
    try {
        const res = await apiFetch('/api/admin/update-user', {
            method: 'POST',
            body: JSON.stringify({ userId: String(userId), role, status })
        });

        if (res.ok) {
            loadUserManagementTable();
        } else {
            const data = await res.json();
            alert(`Failed to update account permissions: ${data.message || 'Error'}`);
        }
    } catch (e) {
        alert('Connection error while updating user.');
    }
}

async function deleteUserAccount(userId) {
    if (!confirm("Are you sure you want to permanently delete this user account?")) return;

    try {
        const res = await apiFetch('/api/admin/delete-user', {
            method: 'POST',
            body: JSON.stringify({ userId: String(userId) })
        });

        const data = await res.json();
        if (res.ok && data.status === 'success') {
            loadUserManagementTable();
        } else {
            alert(`❌ Failed to delete account: ${data.message || 'Unauthorized'}`);
        }
    } catch (e) {
        alert('❌ Network error while deleting user account.');
    }
}

async function fetchDashboardData() {
    try {
        const statsRes = await apiFetch('/api/stats');
        if (statsRes.ok) {
            const stats = await statsRes.json();
            const totalOfficersEl = document.getElementById('total-officers');
            const totalGovEl = document.getElementById('total-gov');
            if (totalOfficersEl) totalOfficersEl.innerText = stats.total_officers ?? 0;
            if (totalGovEl) totalGovEl.innerText = stats.total_gov_members ?? 0;

            const govTotalCountEl = document.getElementById('gov-total-officials');
            if (govTotalCountEl) govTotalCountEl.innerText = stats.total_gov_members ?? 0;

            if (dutyChart) {
                dutyChart.data.datasets[0].data = [stats.total_officers || 0, stats.total_gov_members || 0];
                dutyChart.update();
            }
        } else {
            const totalOfficersEl = document.getElementById('total-officers');
            const totalGovEl = document.getElementById('total-gov');
            if (totalOfficersEl) totalOfficersEl.innerText = '0';
            if (totalGovEl) totalGovEl.innerText = '0';
        }

        const pnpRes = await apiFetch('/api/activity/pnp');
        const pnpTbody = document.getElementById('pnp-activity-body');
        if (pnpRes.ok) {
            const logs = await pnpRes.json();
            if (pnpTbody) {
                pnpTbody.innerHTML = logs.length ? logs.map(item => `<tr><td>${escapeHTML(item.id)}</td><td class="wrap-text">${escapeHTML(item.action)}</td><td class="wrap-text">${escapeHTML(item.user)}</td></tr>`).join('') : '<tr><td colspan="3">No PNP activity logs found.</td></tr>';
            }
        } else {
            if (pnpTbody) pnpTbody.innerHTML = '<tr><td colspan="3" style="color: var(--text-muted);">No recent PNP activity.</td></tr>';
        }

        const govRes = await apiFetch('/api/activity/gov');
        const govTbody = document.getElementById('gov-activity-body');
        if (govRes.ok) {
            const logs = await govRes.json();
            if (govTbody) {
                govTbody.innerHTML = logs.length ? logs.map(item => `<tr><td>${escapeHTML(item.id)}</td><td class="wrap-text">${escapeHTML(item.action)}</td><td class="wrap-text">${escapeHTML(item.user)}</td></tr>`).join('') : '<tr><td colspan="3">No Gov activity logs found.</td></tr>';
            }
        } else {
            if (govTbody) govTbody.innerHTML = '<tr><td colspan="3" style="color: var(--text-muted);">No recent Gov activity.</td></tr>';
        }

    } catch (e) {
        console.error("Dashboard fetch error:", e);
        const pnpTbody = document.getElementById('pnp-activity-body');
        const govTbody = document.getElementById('gov-activity-body');
        if (pnpTbody && pnpTbody.innerHTML.includes('Connecting')) pnpTbody.innerHTML = '<tr><td colspan="3" style="color: var(--accent-red);">Failed to load PNP logs.</td></tr>';
        if (govTbody && govTbody.innerHTML.includes('Connecting')) govTbody.innerHTML = '<tr><td colspan="3" style="color: var(--accent-red);">Failed to load Gov logs.</td></tr>';
    }
}

async function fetchOfficersData() {
    try {
        const res = await apiFetch('/api/officers');
        if (res.ok) {
            const data = await res.json();
            const tbody = document.getElementById('officers-table-body');
            if (!tbody) return;
            const canManage = isPnpAdminOrSuperAdmin();

            const thOfficersActions = document.getElementById('th-officers-actions');
            if (thOfficersActions) thOfficersActions.style.display = canManage ? '' : 'none';

            if (!data.length) {
                tbody.innerHTML = '<tr><td colspan="5">No officers found.</td></tr>';
                return;
            }

            data.sort((a, b) => compareIDs(a.badge, b.badge));

            tbody.innerHTML = data.map(item => {
                const jsBadge = escapeJsArg(item.badge);
                const jsRank = escapeJsArg(item.rank);
                const actionsTd = canManage ? `
                    <td>
                        <div class="action-cell">
                            <button class="btn-warning" onclick="handlePromoteOfficer('${jsBadge}', '${jsRank}')">Promote</button>
                            <button class="btn-danger" onclick="handleDeleteOfficer('${jsBadge}')">Delete</button>
                        </div>
                    </div>` : '';
                return `
                    <tr>
                        <td><code>${escapeHTML(item.badge)}</code></td>
                        <td><strong>${escapeHTML(item.name || 'N/A')}</strong></td>
                        <td>${escapeHTML(item.rank)}</td>
                        <td>${escapeHTML(item.points)} pts</td>
                        ${actionsTd}
                    </tr>
                `;
            }).join('');
        }
    } catch (e) {
        const tbody = document.getElementById('officers-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="color:#ef4444;">Failed to load PNP officers.</td></tr>';
    }
}

async function handleDeleteOfficer(badge) {
    if (!confirm(`Are you sure you want to permanently delete officer ${badge}? Their record will revert to Civilian (CIT-).`)) return;

    try {
        const res = await apiFetch('/api/officers/delete', {
            method: 'POST',
            body: JSON.stringify({ badge: String(badge) })
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.status === 'success' || data.success)) {
            alert('✅ Officer record removed from PNP roster and reverted to civilian status!');
            fetchOfficersData();
            fetchDashboardData();
            loadCitizensData();
        } else {
            alert(`❌ Failed to delete officer: ${data.message || 'Unauthorized'}`);
        }
    } catch (e) {
        alert('❌ Network error while deleting officer.');
    }
}

async function handlePromoteOfficer(badge, currentRank) {
    const newRank = prompt(`Promote/Reassign Officer (${badge})\nCurrent Rank: ${currentRank}\n\nEnter New Rank (e.g. Police Lieutenant):`, currentRank);
    if (!newRank || newRank.trim() === '' || newRank.trim() === currentRank) return;

    try {
        const res = await apiFetch('/api/officers/promote', {
            method: 'POST',
            body: JSON.stringify({ badge: badge, newRank: newRank.trim() })
        });
        const result = await res.json();
        if (res.ok && result.status === 'success') {
            alert(`✅ Officer promoted successfully!\nNew Badge Serial No: ${result.newBadge}`);
            fetchOfficersData();
            fetchDashboardData();
        } else {
            alert(`❌ Promotion failed: ${result.message || 'Unauthorized'}`);
        }
    } catch (err) {
        alert('❌ Network error while promoting officer.');
    }
}

async function fetchGovData() {
    try {
        const res = await apiFetch('/api/government');
        if (res.ok) {
            const data = await res.json();
            const tbody = document.getElementById('gov-table-body');
            if (!tbody) return;
            const canManage = isGovAdminOrSuperAdmin();

            const thGovActions = document.getElementById('th-gov-actions');
            if (thGovActions) thGovActions.style.display = canManage ? '' : 'none';

            const govTotalCountEl = document.getElementById('gov-total-officials');
            if (govTotalCountEl) govTotalCountEl.innerText = data.length;

            if (!data.length) {
                tbody.innerHTML = '<tr><td colspan="5">No government staff found.</td></tr>';
                return;
            }

            data.sort((a, b) => compareIDs(a.id, b.id));

            tbody.innerHTML = data.map(item => {
                const jsId = escapeJsArg(item.id);
                const actionsTd = canManage ? `
                    <td>
                        <div class="action-cell">
                            <button class="btn-danger" onclick="handleDeleteGov('${jsId}')">Delete</button>
                        </div>
                    </div>` : '';
                return `
                    <tr>
                        <td><code>${escapeHTML(item.id)}</code></td>
                        <td><strong>${escapeHTML(item.name || 'N/A')}</strong></td>
                        <td>${escapeHTML(item.position)}</td>
                        <td>${escapeHTML(item.points)} pts</td>
                        ${actionsTd}
                    </tr>
                `;
            }).join('');
        }
    } catch (e) {
        const tbody = document.getElementById('gov-table-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="color:#ef4444;">Failed to load Government personnel.</td></tr>';
    }
}

async function handleDeleteGov(id) {
    if (!confirm(`Are you sure you want to permanently delete government personnel ID ${id}? Their record will revert to Civilian (CIT-).`)) return;

    try {
        const res = await apiFetch('/api/government/delete', {
            method: 'POST',
            body: JSON.stringify({ id: String(id) })
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.status === 'success' || data.success)) {
            alert('✅ Government member removed from roster and reverted to civilian status!');
            fetchGovData();
            fetchDashboardData();
            loadCitizensData();
        } else {
            alert(`❌ Failed to delete personnel: ${data.message || 'Unauthorized'}`);
        }
    } catch (e) {
        alert('❌ Network error while deleting government personnel.');
    }
}

async function handleAddOfficer(e) {
    e.preventDefault();
    const nameInput = document.getElementById('add-officer-name');
    const rankSelect = document.getElementById('add-officer-rank');
    const msgDiv = document.getElementById('add-officer-msg');

    msgDiv.style.color = '#60a5fa';
    msgDiv.innerText = '⏳ Enlisting officer...';

    try {
        const res = await apiFetch('/api/officers/add', {
            method: 'POST',
            body: JSON.stringify({
                name: nameInput.value.trim(),
                rank: rankSelect.value
            })
        });
        const result = await res.json();
        if (res.ok && result.status === 'success') {
            msgDiv.style.color = '#10b981';
            msgDiv.innerText = `✅ Enlisted successfully with Badge No: ${result.badge}`;
            nameInput.value = '';
            fetchOfficersData();
            fetchDashboardData();
        } else {
            msgDiv.style.color = '#ef4444';
            msgDiv.innerText = `❌ Error: ${result.message || 'Unauthorized'}`;
        }
    } catch (err) {
        msgDiv.style.color = '#ef4444';
        msgDiv.innerText = '❌ Failed to connect to server.';
    }
}

async function handleAddGov(e) {
    e.preventDefault();
    const nameInput = document.getElementById('add-gov-name');
    const posInput = document.getElementById('add-gov-pos');
    const msgDiv = document.getElementById('add-gov-msg');

    msgDiv.style.color = '#60a5fa';
    msgDiv.innerText = '⏳ Registering government official...';

    try {
        const res = await apiFetch('/api/government/add', {
            method: 'POST',
            body: JSON.stringify({ name: nameInput.value.trim(), position: posInput.value.trim() })
        });
        const result = await res.json();
        if (res.ok && result.status === 'success') {
            msgDiv.style.color = '#10b981';
            msgDiv.innerText = `✅ Registered official successfully with ID No: ${result.id}`;
            nameInput.value = '';
            posInput.value = '';
            fetchGovData();
            fetchDashboardData();
        } else {
            msgDiv.style.color = '#ef4444';
            msgDiv.innerText = `❌ Error: ${result.message || 'Unauthorized'}`;
        }
    } catch (err) {
        msgDiv.style.color = '#ef4444';
        msgDiv.innerText = '❌ Failed to connect to server.';
    }
}

function ensureSidebarBackButton() {
    let sidebar = document.getElementById('sidebar') || document.querySelector('.sidebar') || document.querySelector('aside');
    if (!sidebar) return null;
    
    let backBtn = document.getElementById('sidebar-back-depts-btn');
    if (!backBtn) {
        backBtn = document.createElement('a');
        backBtn.id = 'sidebar-back-depts-btn';
        backBtn.className = 'nav-item';
        backBtn.href = 'javascript:void(0)';
        backBtn.onclick = backToOverview;
        backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back to Depts';
        backBtn.style.display = 'none';
        sidebar.appendChild(backBtn);
    }
    return backBtn;
}

function openDepartment(deptKey) {
    const overview = document.getElementById('dept-overview-view');
    const detail = document.getElementById('dept-detail-view');
    
    if (overview) overview.style.display = 'none';
    if (detail) {
        detail.style.display = 'flex';
        detail.style.flexDirection = 'column';
        detail.style.width = '100%';
        detail.style.flex = '1';
        detail.style.alignItems = 'center';
        detail.style.justifyContent = 'flex-start';
    }

    // Toggle sidebar navigation states: Show "Back to Departments", Hide "Active Departments"
    const backDeptsItem = document.getElementById('nav-back-depts');
    const mainDeptsItem = document.getElementById('nav-main-depts');
    if (backDeptsItem) backDeptsItem.style.display = 'flex';
    if (mainDeptsItem) mainDeptsItem.style.display = 'none';

    const titleEl = document.getElementById('detail-dept-title');
    
    if (deptKey === 'governors-office') {
        if (titleEl) titleEl.textContent = "Governor's Office Chain of Command";
        loadDepartmentTree("Governor's Office");
    } else if (deptKey === 'mayors-office') {
        if (titleEl) titleEl.textContent = "Mayor's Office Chain of Command";
        loadDepartmentTree("Mayor's Office");
    } else if (deptKey === 'pnp-hq') {
        if (titleEl) titleEl.textContent = "PNP Headquarters Chain of Command";
        loadPnpDepartmentTree();
    } else if (deptKey === 'regional-health') {
        if (titleEl) titleEl.textContent = "Regional Health Department Chain of Command";
        loadHealthDepartmentTree("Regional Health Department");
    } else if (deptKey === 'accounting-office') {
        if (titleEl) titleEl.textContent = "Accounting Office Chain of Command";
        loadBrandNewAccountingTree();
    }
}

function backToOverview() {
    const detail = document.getElementById('dept-detail-view');
    const overview = document.getElementById('dept-overview-view');
    if (detail) detail.style.display = 'none';
    if (overview) overview.style.display = 'block';

    // Toggle sidebar navigation states: Hide "Back to Departments", Show "Active Departments"
    const backDeptsItem = document.getElementById('nav-back-depts');
    const mainDeptsItem = document.getElementById('nav-main-depts');
    if (backDeptsItem) backDeptsItem.style.display = 'none';
    if (mainDeptsItem) mainDeptsItem.style.display = 'flex';
}

function applyContainerStyles(el) {
    if (!el) return;
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.width = '100%';
    el.style.flex = '1';
    el.style.margin = '0 auto';
    el.style.padding = '40px 20px';
    el.style.boxSizing = 'border-box';
}

function createBranchConnectors(count, cardWidth = 190, gap = 20) {
    if (count <= 1) {
        return `<div style="width: 2px; height: 24px; background: #2563eb; margin: 0 auto;"></div>`;
    }
    const bridgeWidth = (count - 1) * (cardWidth + gap);
    return `
        <div style="width: 2px; height: 16px; background: #2563eb; margin: 0 auto;"></div>
        <div style="width: ${bridgeWidth}px; max-width: 90%; height: 2px; background: #2563eb; margin: 0 auto;"></div>
        <div style="display: flex; justify-content: space-between; width: ${bridgeWidth}px; max-width: 90%; margin: 0 auto;">
            ${Array(count).fill('<div style="width: 2px; height: 16px; background: #2563eb;"></div>').join('')}
        </div>
    `;
}

async function loadDepartmentTree(officeName) {
    const rootContainer = document.getElementById('department-tree-root') || document.getElementById('governor-tree-root');
    if (!rootContainer) return;

    applyContainerStyles(rootContainer);
    rootContainer.innerHTML = `<div style="padding: 20px; color: var(--text-muted); text-align: center;">⏳ Loading ${officeName} structure...</div>`;

    try {
        const res = await apiFetch('/api/government');
        let govStaff = res.ok ? await res.json() || [] : [];

        const isGovOffice = officeName.toLowerCase().includes('governor');
        const leaderKeyword = isGovOffice ? 'governor' : 'mayor';

        let filteredStaff = govStaff.filter(g => {
            const office = (g.office || '').toLowerCase().trim();
            return office && office === officeName.toLowerCase().trim();
        });

        if (filteredStaff.length === 0) {
            filteredStaff = govStaff.filter(g => {
                const pos = (g.position || '').toLowerCase().trim();
                return pos.includes(leaderKeyword);
            });
        }

        if (filteredStaff.length === 0 && govStaff.length > 0) {
            filteredStaff = [...govStaff];
        }

        let leader = filteredStaff.find(g => {
            const p = (g.position || '').toLowerCase();
            return p.includes(leaderKeyword) && !p.includes('vice') && !p.includes('secretary') && !p.includes('assistant');
        }) || filteredStaff[0];

        let viceLeader = filteredStaff.find(g => {
            const p = (g.position || '').toLowerCase();
            return p.includes('vice') && p.includes(leaderKeyword) && !p.includes('secretary') && !p.includes('assistant');
        });

        let mainSec = filteredStaff.find(g => {
            const p = (g.position || '').toLowerCase();
            return p.includes('secretary') && p.includes(leaderKeyword) && !p.includes('vice');
        });

        let mainAsst = filteredStaff.find(g => {
            const p = (g.position || '').toLowerCase();
            return (p.includes('assistant') || p.includes('staff')) && p.includes(leaderKeyword) && !p.includes('vice');
        });

        let viceSec = filteredStaff.find(g => {
            const p = (g.position || '').toLowerCase();
            return p.includes('secretary') && (p.includes('vice') || p.includes('for the vice'));
        });

        let viceAsst = filteredStaff.find(g => {
            const p = (g.position || '').toLowerCase();
            return (p.includes('assistant') || p.includes('staff')) && (p.includes('vice') || (p.includes('for the vice') && !p.includes('governor')));
        });

        function renderBoxTop(person, defaultTitle) {
            const isVacant = !person;
            const badge = isVacant ? 'VACANT' : escapeHTML(person.id || person.badge || 'GO-0000');
            const name = isVacant ? 'Unassigned' : escapeHTML(person.name || 'Unnamed');
            const title = isVacant ? defaultTitle : escapeHTML(person.position || defaultTitle);
            const styleAttr = isVacant ? 'opacity: 0.55; border-style: dashed;' : '';

            return `
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="tree-node-box" style="${styleAttr}; width: 190px; text-align: center; background: #131b2e; margin: 0; z-index: 2;">
                        <span class="tree-badge">${badge}</span>
                        <div class="tree-name">${name}</div>
                        <div class="tree-title">${title}</div>
                    </div>
                </div>
            `;
        }

        function renderBoxBottomClean(person, defaultTitle, isLeaderBox = false) {
            const isVacant = !person;
            const badge = isVacant ? 'VACANT' : escapeHTML(person.id || person.badge || 'GO-0000');
            const name = isVacant ? 'Unassigned' : escapeHTML(person.name || 'Unnamed');
            const title = isVacant ? defaultTitle : escapeHTML(person.position || defaultTitle);
            const styleAttr = isVacant ? 'opacity: 0.55; border-style: dashed;' : '';
            const boxWidth = isLeaderBox ? '210px' : '190px';

            return `
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="tree-node-box ${isLeaderBox ? 'leader-node' : ''}" style="${styleAttr}; width: ${boxWidth}; text-align: center; background: #131b2e; margin: 0; z-index: 2;">
                        <span class="tree-badge">${badge}</span>
                        <div class="tree-name">${name}</div>
                        <div class="tree-title">${title}</div>
                    </div>
                </div>
            `;
        }

        const secTitle = isGovOffice ? "Personal Secretary of the Governor" : "Secretary to the Mayor";
        const asstTitle = isGovOffice ? "Personal Assistant of the Governor" : "Personal Assistant to the Mayor";
        const viceTitle = isGovOffice ? "Vice Governor" : "Vice Mayor";
        const viceSecTitle = isGovOffice ? "Personal Secretary of the Vice Governor" : "Secretary to the Vice Mayor";
        const viceAsstTitle = isGovOffice ? "Personal Assistant of the Vice Governor" : "Personal Assistant to the Vice Mayor";

        const bridgeWidth = 460;
        const bottomConnectorHtml = `
            <div style="width: 2px; height: 16px; background: #2563eb; margin: 0 auto;"></div>
            <div style="width: ${bridgeWidth}px; max-width: 90%; height: 2px; background: #2563eb; margin: 0 auto;"></div>
            <div style="display: flex; justify-content: space-between; width: ${bridgeWidth}px; max-width: 90%; margin: 0 auto;">
                <div style="width: 2px; height: 16px; background: #2563eb;"></div>
                <div style="width: 2px; height: 16px; background: #2563eb;"></div>
                <div style="width: 2px; height: 16px; background: #2563eb;"></div>
            </div>
        `;

        let treeHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; max-width: 1000px; margin: 0 auto; padding-bottom: 40px;">
                
                <div style="display: flex; align-items: center; justify-content: center; width: 100%; margin-bottom: 0;">
                    <div style="display: flex; align-items: center; justify-content: flex-end; flex: 1;">
                        ${renderBoxTop(mainSec, secTitle)}
                        <div style="width: 40px; height: 2px; background: #2563eb;"></div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: center; flex-shrink: 0;">
                        <div class="tree-node-box leader-node" style="width: 210px; text-align: center; z-index: 2; margin: 0 10px; background: #131b2e;">
                            <span class="tree-badge">${leader ? escapeHTML(leader.id || leader.badge) : 'VACANT'}</span>
                            <div class="tree-name">${leader ? escapeHTML(leader.name) : 'Unassigned'}</div>
                            <div class="tree-title">${leader ? escapeHTML(leader.position) : (isGovOffice ? 'Governor' : 'Mayor')}</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: flex-start; flex: 1;">
                        <div style="width: 40px; height: 2px; background: #2563eb;"></div>
                        ${renderBoxTop(mainAsst, asstTitle)}
                    </div>
                </div>

                ${bottomConnectorHtml}

                <div style="display: flex; justify-content: center; gap: 30px; width: 100%; margin-top: 0;">
                    ${renderBoxBottomClean(viceSec, viceSecTitle, false)}
                    ${renderBoxBottomClean(viceLeader, viceTitle, true)}
                    ${renderBoxBottomClean(viceAsst, viceAsstTitle, false)}
                </div>

            </div>
        `;

        rootContainer.innerHTML = treeHtml;

    } catch (err) {
        console.error("Error loading department tree:", err);
        rootContainer.innerHTML = `<p style="color: var(--accent-red); text-align: center;">Failed to load ${officeName} structure.</p>`;
    }
}

async function loadPnpDepartmentTree() {
    const rootContainer = document.getElementById('department-tree-root') || document.getElementById('governor-tree-root');
    if (!rootContainer) return;

    applyContainerStyles(rootContainer);
    rootContainer.innerHTML = '<div style="padding: 20px; color: var(--text-muted); text-align: center;">⏳ Loading PNP structure...</div>';

    try {
        const res = await apiFetch('/api/officers');
        let officers = res.ok ? await res.json() || [] : [];

        if (officers.length === 0) {
            rootContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center;">No PNP officers found.</p>';
            return;
        }

        const rankWeights = {
            "police general": 1,
            "police lieutenant general": 2,
            "police major general": 3,
            "police brigadier general": 4,
            "police colonel": 5,
            "police lieutenant colonel": 6,
            "police major": 7,
            "police captain": 8,
            "police lieutenant": 9,
            "police executive master sergeant": 10,
            "police chief master sergeant": 11,
            "police senior master sergeant": 12,
            "police master sergeant": 13,
            "police staff sergeant": 14,
            "police corporal": 15,
            "patrolman": 16
        };

        officers.sort((a, b) => {
            const wA = rankWeights[(a.rank || '').toLowerCase().trim()] || 99;
            const wB = rankWeights[(b.rank || '').toLowerCase().trim()] || 99;
            return wA - wB;
        });

        let general = officers.find(o => (o.rank || '').toLowerCase().includes('general')) || officers[0];
        let remaining = officers.filter(o => o !== general);

        const rowSize = 5;
        let rows = [];
        for (let i = 0; i < remaining.length; i += rowSize) {
            rows.push(remaining.slice(i, i + rowSize));
        }

        function renderCardBottomClean(o) {
            return `
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="tree-node-box" style="width: 190px; text-align: center; background: #131b2e; margin: 0;">
                        <span class="tree-badge">${escapeHTML(o.badge || '09-0000')}</span>
                        <div class="tree-name">${escapeHTML(o.name || 'Unnamed')}</div>
                        <div class="tree-title">${escapeHTML(o.rank || 'Officer')}</div>
                    </div>
                </div>
            `;
        }

        let treeHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; max-width: 1200px; margin: 0 auto; padding-bottom: 40px;">
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="tree-node-box leader-node" style="width: 220px; text-align: center; z-index: 2; background: #131b2e;">
                        <span class="tree-badge">${escapeHTML(general.badge || '09-0001')}</span>
                        <div class="tree-name">${escapeHTML(general.name || 'General')}</div>
                        <div class="tree-title">${escapeHTML(general.rank || 'Police General')}</div>
                    </div>
                </div>
        `;

        if (rows.length > 0) {
            rows.forEach((row) => {
                treeHtml += createBranchConnectors(row.length, 190, 20);
                treeHtml += `
                    <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; width: 100%; margin-top: 0;">
                        ${row.map(o => renderCardBottomClean(o)).join('')}
                    </div>
                `;
            });
        }

        treeHtml += `</div>`;
        rootContainer.innerHTML = treeHtml;

    } catch (err) {
        console.error("Error loading PNP tree:", err);
        rootContainer.innerHTML = '<p style="color: var(--accent-red); text-align: center;">Failed to load PNP structure.</p>';
    }
}

async function loadHealthDepartmentTree(officeName) {
    const rootContainer = document.getElementById('department-tree-root') || document.getElementById('governor-tree-root');
    if (!rootContainer) return;

    applyContainerStyles(rootContainer);
    rootContainer.innerHTML = `<div style="padding: 20px; color: var(--text-muted); text-align: center;">⏳ Loading ${officeName} structure...</div>`;

    try {
        const res = await apiFetch('/api/government');
        let govStaff = res.ok ? await res.json() || [] : [];

        let filteredStaff = govStaff.filter(g => {
            const office = (g.office || '').toLowerCase().trim();
            return office && office.includes('health');
        });

        if (filteredStaff.length === 0) {
            filteredStaff = govStaff.filter(g => {
                const pos = (g.position || '').toLowerCase().trim();
                return pos.includes('health') || pos.includes('medical') || pos.includes('doctor') || pos.includes('nurse');
            });
        }

        let director = filteredStaff.find(g => {
            const p = (g.position || '').toLowerCase();
            return p.includes('director') || p.includes('chief') || p.includes('head');
        }) || filteredStaff[0];

        let staffList = filteredStaff.filter(g => g !== director);
        if (staffList.length === 0) {
            staffList = [null, null];
        }

        function renderBoxBottom(person, defaultTitle) {
            const isVacant = !person;
            const badge = isVacant ? 'VACANT' : escapeHTML(person.id || person.badge || 'GO-0000');
            const name = isVacant ? 'Unassigned' : escapeHTML(person.name || 'Unnamed');
            const title = isVacant ? defaultTitle : escapeHTML(person.position || defaultTitle);
            const styleAttr = isVacant ? 'opacity: 0.55; border-style: dashed;' : '';

            return `
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="tree-node-box" style="${styleAttr}; width: 190px; text-align: center; background: #131b2e; margin: 0;">
                        <span class="tree-badge">${badge}</span>
                        <div class="tree-name">${name}</div>
                        <div class="tree-title">${title}</div>
                    </div>
                </div>
            `;
        }

        let staffHtml = staffList.map((staff, idx) => {
            const defaultT = idx === 0 ? 'Assistant Health Officer' : 'Resident Nurse';
            return renderBoxBottom(staff, defaultT);
        }).join('');

        const connectorHtml = createBranchConnectors(staffList.length, 190, 30);

        let treeHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; max-width: 1000px; margin: 0 auto; padding-bottom: 40px;">
                
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="tree-node-box leader-node" style="width: 220px; text-align: center; z-index: 2; background: #131b2e;">
                        <span class="tree-badge">${director ? escapeHTML(director.id || director.badge) : 'VACANT'}</span>
                        <div class="tree-name">${director ? escapeHTML(director.name) : 'Unassigned'}</div>
                        <div class="tree-title">${director ? escapeHTML(director.position) : 'Regional Health Director'}</div>
                    </div>
                </div>

                ${connectorHtml}

                <div style="display: flex; justify-content: center; gap: 30px; width: 100%; margin-top: 0;">
                    ${staffHtml}
                </div>

            </div>
        `;

        rootContainer.innerHTML = treeHtml;

    } catch (err) {
        console.error("Error loading health department tree:", err);
        rootContainer.innerHTML = `<p style="color: var(--accent-red); text-align: center;">Failed to load ${officeName} structure.</p>`;
    }
}

async function loadBrandNewAccountingTree() {
    const rootContainer = document.getElementById('department-tree-root') || document.getElementById('governor-tree-root');
    if (!rootContainer) return;

    applyContainerStyles(rootContainer);
    rootContainer.innerHTML = `<div style="padding: 20px; color: var(--text-muted); text-align: center;">⏳ Loading Accounting Office structure...</div>`;

    try {
        const res = await apiFetch('/api/government');
        let govStaff = res.ok ? await res.json() || [] : [];

        let members = govStaff.filter(g => {
            const office = (g.office || '').toLowerCase();
            const pos = (g.position || '').toLowerCase();
            return office.includes('accounting') || pos.includes('accounting') || pos.includes('accountant') || pos.includes('audit') || pos.includes('payroll') || pos.includes('budget') || pos.includes('finance');
        });

        let chief = members.find(g => {
            const p = (g.position || '').toLowerCase();
            return p.includes('head') || p.includes('chief') || p.includes('director') || p.includes('senior');
        }) || members[0];

        let subordinates = members.filter(g => g !== chief);
        if (subordinates.length === 0) {
            subordinates = [null, null, null];
        }

        function renderBoxBottom(person, defaultTitle) {
            const isVacant = !person;
            const badge = isVacant ? 'VACANT' : escapeHTML(person.id_no || person.id || person.badge || 'GO-0000');
            const name = isVacant ? 'Unassigned' : escapeHTML(person.name || 'Unnamed');
            const title = isVacant ? defaultTitle : escapeHTML(person.position || defaultTitle);
            const styleAttr = isVacant ? 'opacity: 0.55; border-style: dashed;' : '';

            return `
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="tree-node-box" style="${styleAttr}; width: 190px; text-align: center; background: #131b2e; margin: 0;">
                        <span class="tree-badge">${badge}</span>
                        <div class="tree-name">${name}</div>
                        <div class="tree-title">${title}</div>
                    </div>
                </div>
            `;
        }

        let subsHtml = subordinates.map((staff, idx) => {
            const defaultT = idx === 0 ? 'Head of the Municipal Accounting Department' : (idx === 1 ? 'Budget Officer' : 'Financial Records Officer');
            return renderBoxBottom(staff, defaultT);
        }).join('');

        const subsConnectorHtml = createBranchConnectors(subordinates.length, 190, 30);

        let treeHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; max-width: 1000px; margin: 0 auto; padding-bottom: 40px;">
                
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="tree-node-box leader-node" style="width: 220px; text-align: center; z-index: 2; background: #131b2e;">
                        <span class="tree-badge">${chief ? escapeHTML(chief.id_no || chief.id || chief.badge) : 'VACANT'}</span>
                        <div class="tree-name">${chief ? escapeHTML(chief.name) : 'Unassigned'}</div>
                        <div class="tree-title">${chief ? escapeHTML(chief.position) : 'Accounting Department Head'}</div>
                    </div>
                </div>

                ${subsConnectorHtml}

                <div style="display: flex; justify-content: center; gap: 30px; width: 100%; margin-top: 0;">
                    ${subsHtml}
                </div>

            </div>
        `;

        rootContainer.innerHTML = treeHtml;

    } catch (err) {
        console.error("Error loading accounting tree:", err);
        rootContainer.innerHTML = `<p style="color: var(--accent-red); text-align: center;">Failed to load Accounting Office structure.</p>`;
    }
}

checkAuthState();