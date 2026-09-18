"""Version 2 desktop interface for the Aedes aegypti control model.

This file is intentionally self-contained at the UI layer.  It calls the
existing optimization and fixed-schedule functions without modifying them.
"""

from __future__ import annotations

import json
import os
import queue
import threading
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import matplotlib.dates as mdates
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
from matplotlib.figure import Figure
from matplotlib.ticker import FuncFormatter, MaxNLocator
import numpy as np
import pandas as pd

from Optimize_AEDES_AEGYPTI import Optimize_AEDES_AEGYPTI
from Run_AEDES_AEGYPTI import Run_AEDES_AEGYPTI


APP_BG = "#f3f6f8"
PANEL = "#ffffff"
INK = "#17222b"
MUTED = "#62727e"
ACCENT = "#087f8c"
ACCENT_DARK = "#05616b"
PALE_ACCENT = "#e6f4f5"
BORDER = "#dbe4e8"
SUCCESS = "#23856d"
WARNING = "#b66a19"
ERROR = "#b33a3a"
BLUE = "#3178b5"
ORANGE = "#e07a3f"


class ScrollableFrame(ttk.Frame):
    """A vertically scrollable ttk frame."""

    def __init__(self, master: tk.Misc, **kwargs) -> None:
        super().__init__(master, **kwargs)
        self.canvas = tk.Canvas(self, background=PANEL, highlightthickness=0)
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.body = ttk.Frame(self.canvas, style="Panel.TFrame")
        self._window = self.canvas.create_window((0, 0), window=self.body, anchor="nw")

        self.canvas.configure(yscrollcommand=scrollbar.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.body.bind(
            "<Configure>",
            lambda _event: self.canvas.configure(scrollregion=self.canvas.bbox("all")),
        )
        self.canvas.bind(
            "<Configure>",
            lambda event: self.canvas.itemconfigure(self._window, width=event.width),
        )
        self.canvas.bind("<Enter>", self._bind_wheel)
        self.canvas.bind("<Leave>", self._unbind_wheel)

    def _bind_wheel(self, _event: tk.Event) -> None:
        self.canvas.bind_all("<MouseWheel>", self._on_wheel)

    def _unbind_wheel(self, _event: tk.Event) -> None:
        self.canvas.unbind_all("<MouseWheel>")

    def _on_wheel(self, event: tk.Event) -> None:
        self.canvas.yview_scroll(int(-event.delta / 120), "units")


class AedesControlApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Aedes Control")
        self.geometry("1320x850")
        self.minsize(1080, 700)
        self.configure(background=APP_BG)

        self.optimization_vars: dict[str, tk.StringVar] = {}
        self.schedule_vars: dict[str, tk.StringVar] = {}
        self.active_output = tk.StringVar(value="No result folder loaded")
        self.status_text = tk.StringVar(value="Ready")
        self.metric_population = tk.StringVar(value="—")
        self.metric_risk = tk.StringVar(value="—")
        self.metric_days = tk.StringVar(value="—")
        self.calendar_summary = tk.StringVar(value="Calendar details will appear after results are loaded.")
        self.schedule_lists: dict[str, tk.Listbox] = {}
        self.schedule_counts: dict[str, tk.StringVar] = {}
        self.schedule_details: dict[str, tk.StringVar] = {}
        self._events: queue.Queue[tuple[str, object]] = queue.Queue()
        self._running = False
        self._plot_limits: tuple[tuple[float, float], tuple[float, float], tuple[float, float]] | None = None
        self._date_select_mode = False
        self._selection_start: float | None = None
        self._selection_patches: list[object] = []
        self.date_select_text = tk.StringVar(value="Select date window")

        self._configure_styles()
        self._build_header()
        self._build_workspace()
        self._build_status_bar()
        self.after(100, self._process_events)

    # ------------------------------------------------------------------ UI
    def _configure_styles(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure("App.TFrame", background=APP_BG)
        style.configure("Panel.TFrame", background=PANEL)
        style.configure("Card.TFrame", background=PANEL, relief="solid", borderwidth=1)
        style.configure("Header.TLabel", background=PANEL, foreground=INK, font=("Segoe UI Semibold", 16))
        style.configure("Section.TLabel", background=PANEL, foreground=INK, font=("Segoe UI Semibold", 11))
        style.configure("Body.TLabel", background=PANEL, foreground=INK, font=("Segoe UI", 9))
        style.configure("Muted.TLabel", background=PANEL, foreground=MUTED, font=("Segoe UI", 9))
        style.configure("Metric.TLabel", background=PANEL, foreground=ACCENT_DARK, font=("Segoe UI Semibold", 18))
        style.configure("MetricName.TLabel", background=PANEL, foreground=MUTED, font=("Segoe UI", 8))
        style.configure("Status.TLabel", background="#e9eef1", foreground=MUTED, font=("Segoe UI", 9))

        style.configure(
            "Accent.TButton",
            background=ACCENT,
            foreground="white",
            bordercolor=ACCENT,
            focusthickness=0,
            padding=(15, 9),
            font=("Segoe UI Semibold", 9),
        )
        style.map("Accent.TButton", background=[("active", ACCENT_DARK), ("disabled", "#91b8bc")])
        style.configure(
            "Secondary.TButton",
            background="#eef3f5",
            foreground=INK,
            bordercolor=BORDER,
            padding=(11, 7),
            font=("Segoe UI", 9),
        )
        style.map("Secondary.TButton", background=[("active", "#dfeaed")])
        style.configure("TEntry", padding=7, fieldbackground="#fbfcfd", bordercolor=BORDER)
        style.configure("TNotebook", background=APP_BG, borderwidth=0)
        style.configure("TNotebook.Tab", padding=(16, 9), font=("Segoe UI Semibold", 9))
        style.map(
            "TNotebook.Tab",
            background=[("selected", PANEL), ("!selected", "#e6ecef")],
            foreground=[("selected", ACCENT_DARK), ("!selected", MUTED)],
        )
        style.configure("Treeview", rowheight=29, bordercolor=BORDER, fieldbackground=PANEL)
        style.configure("Treeview.Heading", font=("Segoe UI Semibold", 9), padding=6)
        style.configure("Horizontal.TProgressbar", background=ACCENT, troughcolor="#dfe7ea")

    def _build_header(self) -> None:
        header = tk.Frame(self, background="#12313b", height=96)
        header.pack(fill="x")
        header.pack_propagate(False)

        title_area = tk.Frame(header, background="#12313b")
        title_area.pack(side="left", padx=28, pady=18)
        tk.Label(
            title_area,
            text="AEDES CONTROL",
            background="#12313b",
            foreground="white",
            font=("Segoe UI Semibold", 17),
        ).pack(side="left", anchor="w")
        tk.Label(
            title_area,
            text="Simulation, intervention planning, and outcome comparison",
            background="#12313b",
            foreground="#bcd1d6",
            font=("Segoe UI", 9),
        ).pack(side="left", anchor="w", padx=(10, 0))

    def _build_workspace(self) -> None:
        workspace = ttk.Panedwindow(self, orient="horizontal")
        workspace.pack(fill="both", expand=True, padx=18, pady=16)

        controls_panel = ttk.Frame(workspace, style="Panel.TFrame", width=440)
        results_panel = ttk.Frame(workspace, style="Panel.TFrame")
        workspace.add(controls_panel, weight=1)
        workspace.add(results_panel, weight=2)

        self.mode_tabs = ttk.Notebook(controls_panel)
        self.mode_tabs.pack(fill="both", expand=True)
        optimization_tab = ScrollableFrame(self.mode_tabs)
        schedule_tab = ScrollableFrame(self.mode_tabs)
        self.mode_tabs.add(optimization_tab, text="Optimize")
        self.mode_tabs.add(schedule_tab, text="Fixed schedule")
        self._build_optimization_form(optimization_tab.body)
        self._build_schedule_form(schedule_tab.body)

        self._build_results_panel(results_panel)

    def _build_optimization_form(self, parent: ttk.Frame) -> None:
        self._form_intro(
            parent,
            "Optimize control timing",
            "Search for treatment dates that reduce mosquito abundance and transmission risk.",
        )
        controls = self._section(parent, "Control measures", "Durations are in days; efficiencies range from 0 to 1.")
        self._add_three_column_headers(controls, "Treatment", "Duration", "Applications", "Efficiency")
        rows = [
            ("Insecticide", "len_ins", "2", "numtris", "2", "is_ef", "0.2"),
            ("Larvicide", "len_lr", "20", "numtrls", "2", "ls_ef", "0.8"),
            ("Habitat removal", "len_cr", "40", "numtrcl", "1", "cl_ef", "0.5"),
        ]
        for row_index, (name, duration_key, duration, count_key, count, efficiency_key, efficiency) in enumerate(rows, 1):
            ttk.Label(controls, text=name, style="Body.TLabel").grid(row=row_index, column=0, sticky="w", pady=5)
            self._compact_entry(controls, self.optimization_vars, duration_key, duration, row_index, 1)
            self._compact_entry(controls, self.optimization_vars, count_key, count, row_index, 2)
            self._compact_entry(controls, self.optimization_vars, efficiency_key, efficiency, row_index, 3)

        self._data_section(parent, self.optimization_vars, "Aedes_Aegypti")

        self._location_section(parent, self.optimization_vars)

        self.optimize_button = ttk.Button(
            parent,
            text="Run optimization",
            style="Accent.TButton",
            command=self._start_optimization,
        )
        self.optimize_button.pack(fill="x", padx=18, pady=(4, 20))

    def _build_schedule_form(self, parent: ttk.Frame) -> None:
        self._form_intro(
            parent,
            "Evaluate a fixed schedule",
            "Test treatment dates you choose and compare them with the uncontrolled baseline.",
        )
        controls = self._section(
            parent,
            "Control measures",
            "Type comma-separated dates in YYYY-MM-DD format, or load them from a CSV file.",
        )
        fixed_rows = [
            ("Insecticide", "len_ins", "2", "is_ef", "0.05", "insecticide_dates"),
            ("Larvicide", "len_lr", "15", "ls_ef", "0.05", "larvicide_dates"),
            ("Habitat removal", "len_cr", "20", "cl_ef", "0.3", "habitat_dates"),
        ]
        for index, (name, duration_key, duration, efficiency_key, efficiency, dates_key) in enumerate(fixed_rows):
            card = ttk.Frame(controls, style="Panel.TFrame")
            card.grid(row=index, column=0, columnspan=4, sticky="ew", pady=(4, 9))
            card.columnconfigure(2, weight=1)
            ttk.Label(card, text=name, style="Section.TLabel").grid(row=0, column=0, columnspan=4, sticky="w")
            ttk.Label(card, text="Duration", style="Muted.TLabel").grid(row=1, column=0, sticky="w", pady=(4, 1))
            ttk.Label(card, text="Efficiency", style="Muted.TLabel").grid(row=1, column=1, sticky="w", padx=(9, 0), pady=(4, 1))
            ttk.Label(card, text="Application dates", style="Muted.TLabel").grid(row=1, column=2, columnspan=2, sticky="w", padx=(9, 0), pady=(4, 1))
            self._compact_entry(card, self.schedule_vars, duration_key, duration, 2, 0, width=8)
            self._compact_entry(card, self.schedule_vars, efficiency_key, efficiency, 2, 1, width=9, padx=(9, 0))
            self._compact_entry(card, self.schedule_vars, dates_key, "", 2, 2, width=25, padx=(9, 0), sticky="ew")
            ttk.Button(
                card,
                text="From CSV…",
                style="Secondary.TButton",
                command=lambda target=self.schedule_vars[dates_key]: self._load_dates_from_csv(target),
            ).grid(row=2, column=3, padx=(7, 0))

        self._data_section(parent, self.schedule_vars, "Aedes_Aegypti_FixedSchedule")

        self._location_section(parent, self.schedule_vars)

        self.schedule_button = ttk.Button(
            parent,
            text="Run fixed schedule",
            style="Accent.TButton",
            command=self._start_schedule,
        )
        self.schedule_button.pack(fill="x", padx=18, pady=(4, 20))

    def _form_intro(self, parent: ttk.Frame, title: str, description: str) -> None:
        frame = ttk.Frame(parent, style="Panel.TFrame")
        frame.pack(fill="x", padx=18, pady=(20, 5))
        ttk.Label(frame, text=title, style="Header.TLabel").pack(anchor="w")
        ttk.Label(frame, text=description, style="Muted.TLabel", wraplength=370).pack(anchor="w", pady=(4, 0))

    def _section(self, parent: ttk.Frame, title: str, subtitle: str = "") -> ttk.Frame:
        outer = ttk.Frame(parent, style="Card.TFrame")
        outer.pack(fill="x", padx=18, pady=10)
        ttk.Label(outer, text=title, style="Section.TLabel").grid(row=0, column=0, columnspan=4, sticky="w", padx=14, pady=(12, 1))
        if subtitle:
            ttk.Label(outer, text=subtitle, style="Muted.TLabel", wraplength=360).grid(
                row=1, column=0, columnspan=4, sticky="w", padx=14, pady=(0, 8)
            )
        content = ttk.Frame(outer, style="Panel.TFrame")
        content.grid(row=2, column=0, sticky="ew", padx=14, pady=(0, 13))
        outer.columnconfigure(0, weight=1)
        content.columnconfigure(0, weight=1)
        return content

    def _location_section(self, parent: ttk.Frame, variables: dict[str, tk.StringVar]) -> None:
        frame = self._section(parent, "Location", "Enter coordinates directly or select a point on the map.")
        frame.columnconfigure(0, weight=1)
        frame.columnconfigure(1, weight=1)
        self._labeled_entry(frame, variables, "Latitude", "latitude", "25.84", 0, 0)
        self._labeled_entry(frame, variables, "Longitude", "longitude", "-80.26", 0, 1, padx=(8, 0))
        ttk.Button(
            frame,
            text="Select location on map",
            style="Secondary.TButton",
            command=lambda: self._open_map(variables),
        ).grid(row=2, column=0, columnspan=2, sticky="ew", pady=(9, 0))

    def _data_section(self, parent: ttk.Frame, variables: dict[str, tk.StringVar], default_output: str) -> None:
        frame = self._section(parent, "Data and output", "Choose climate inputs and where this run should be saved.")
        frame.columnconfigure(0, weight=1)
        fields = [
            ("Temperature data", "adtemp", "temp_pastyearsav_py.mat", "file"),
            ("Precipitation data", "adpre", "pre_pastyearsav_py.mat", "file"),
            ("Results folder", "adsave", default_output, "folder"),
        ]
        for row, (label, key, default, kind) in enumerate(fields):
            ttk.Label(frame, text=label, style="Muted.TLabel").grid(row=row * 2, column=0, sticky="w", pady=(5, 2))
            variables[key] = tk.StringVar(value=default)
            ttk.Entry(frame, textvariable=variables[key]).grid(row=row * 2 + 1, column=0, sticky="ew")
            if kind == "file":
                command = lambda target=variables[key]: self._browse_file(target)
            else:
                command = lambda target=variables[key]: self._browse_folder(target)
            ttk.Button(frame, text="Browse", style="Secondary.TButton", command=command).grid(
                row=row * 2 + 1, column=1, padx=(7, 0)
            )

    def _labeled_entry(
        self,
        parent: ttk.Frame,
        variables: dict[str, tk.StringVar],
        label: str,
        key: str,
        default: str,
        row: int,
        column: int,
        padx: tuple[int, int] = (0, 0),
    ) -> None:
        ttk.Label(parent, text=label, style="Muted.TLabel").grid(row=row, column=column, sticky="w", padx=padx)
        variables[key] = tk.StringVar(value=default)
        ttk.Entry(parent, textvariable=variables[key]).grid(row=row + 1, column=column, sticky="ew", padx=padx, pady=(2, 0))

    def _add_three_column_headers(self, parent: ttk.Frame, *labels: str) -> None:
        for column, label in enumerate(labels):
            ttk.Label(parent, text=label, style="Muted.TLabel").grid(row=0, column=column, sticky="w", padx=(0, 7), pady=(0, 3))
        for column in range(1, 4):
            parent.columnconfigure(column, weight=1)

    def _compact_entry(
        self,
        parent: ttk.Frame,
        variables: dict[str, tk.StringVar],
        key: str,
        default: str,
        row: int,
        column: int,
        width: int = 10,
        padx: tuple[int, int] = (0, 7),
        sticky: str = "ew",
    ) -> None:
        variables[key] = tk.StringVar(value=default)
        ttk.Entry(parent, textvariable=variables[key], width=width).grid(row=row, column=column, sticky=sticky, padx=padx, pady=3)

    def _build_results_panel(self, parent: ttk.Frame) -> None:
        toolbar = ttk.Frame(parent, style="Panel.TFrame")
        toolbar.pack(fill="x", padx=18, pady=(18, 8))
        ttk.Label(toolbar, text="Results dashboard", style="Header.TLabel").pack(side="left")
        ttk.Button(toolbar, text="Load results", style="Secondary.TButton", command=self._choose_results).pack(side="right")
        ttk.Button(toolbar, text="Refresh", style="Secondary.TButton", command=self._refresh_active_results).pack(side="right", padx=7)

        folder_line = ttk.Frame(parent, style="Panel.TFrame")
        folder_line.pack(fill="x", padx=18, pady=(0, 12))
        ttk.Label(folder_line, text="SOURCE", style="Muted.TLabel").pack(side="left")
        ttk.Label(folder_line, textvariable=self.active_output, style="Body.TLabel").pack(side="left", padx=(8, 0))

        metrics = ttk.Frame(parent, style="Panel.TFrame")
        metrics.pack(fill="x", padx=18, pady=(0, 12))
        for column in range(3):
            metrics.columnconfigure(column, weight=1)
        self._metric_card(metrics, 0, "AVG. POPULATION REDUCTION", self.metric_population)
        self._metric_card(metrics, 1, "PEAK RISK REDUCTION", self.metric_risk)
        self._metric_card(metrics, 2, "DAYS MODELED", self.metric_days)

        result_tabs = ttk.Notebook(parent)
        result_tabs.pack(fill="both", expand=True, padx=18, pady=(0, 18))
        plot_tab = ttk.Frame(result_tabs, style="Panel.TFrame")
        schedule_tab = ttk.Frame(result_tabs, style="Panel.TFrame")
        log_tab = ttk.Frame(result_tabs, style="Panel.TFrame")
        result_tabs.add(plot_tab, text="Outcome charts")
        result_tabs.add(schedule_tab, text="Treatment schedule")
        result_tabs.add(log_tab, text="Run log")

        self.figure = Figure(figsize=(8.2, 6.0), dpi=100, facecolor=PANEL)
        self.population_axis = self.figure.add_subplot(211)
        self.risk_axis = self.figure.add_subplot(212, sharex=self.population_axis)
        self.figure.subplots_adjust(left=0.10, right=0.97, top=0.94, bottom=0.12, hspace=0.32)

        plot_controls = ttk.Frame(plot_tab, style="Panel.TFrame")
        plot_controls.pack(fill="x", padx=8, pady=(8, 2))
        ttk.Label(plot_controls, text="EXPLORE", style="Muted.TLabel").pack(side="left", padx=(4, 8))
        ttk.Button(
            plot_controls,
            text="Reset view",
            style="Secondary.TButton",
            command=self._reset_plot_view,
        ).pack(side="left", padx=(0, 5))
        ttk.Button(
            plot_controls,
            text="Pan",
            style="Secondary.TButton",
            command=lambda: self._activate_plot_tool("pan"),
        ).pack(side="left", padx=(0, 5))
        ttk.Button(
            plot_controls,
            text="Box zoom",
            style="Secondary.TButton",
            command=lambda: self._activate_plot_tool("zoom"),
        ).pack(side="left", padx=(0, 5))
        ttk.Button(
            plot_controls,
            textvariable=self.date_select_text,
            style="Secondary.TButton",
            command=self._toggle_date_selection,
        ).pack(side="left")
        ttk.Label(
            plot_controls,
            text="Tip: scroll over a chart to zoom in time",
            style="Muted.TLabel",
        ).pack(side="right", padx=5)

        self.plot_canvas = FigureCanvasTkAgg(self.figure, master=plot_tab)
        self.plot_canvas.get_tk_widget().pack(fill="both", expand=True)
        self.plot_toolbar = NavigationToolbar2Tk(self.plot_canvas, plot_tab, pack_toolbar=False)
        self.plot_toolbar.update()
        self.plot_toolbar.pack(fill="x")
        self.plot_canvas.mpl_connect("scroll_event", self._on_plot_scroll)
        self.plot_canvas.mpl_connect("button_press_event", self._on_plot_press)
        self.plot_canvas.mpl_connect("motion_notify_event", self._on_plot_motion)
        self.plot_canvas.mpl_connect("button_release_event", self._on_plot_release)
        self._draw_empty_plot()

        schedule_header = ttk.Frame(schedule_tab, style="Panel.TFrame")
        schedule_header.pack(fill="x", padx=16, pady=(16, 10))
        ttk.Label(schedule_header, text="Treatment plan", style="Header.TLabel").pack(anchor="w")
        ttk.Label(
            schedule_header,
            textvariable=self.calendar_summary,
            style="Muted.TLabel",
            wraplength=680,
        ).pack(anchor="w", pady=(2, 0))

        schedule_cards = ttk.Frame(schedule_tab, style="Panel.TFrame")
        schedule_cards.pack(fill="both", expand=True, padx=12, pady=(0, 16))
        for column in range(3):
            schedule_cards.columnconfigure(column, weight=1, uniform="treatments")
        schedule_cards.rowconfigure(0, weight=1)
        self._build_schedule_card(
            schedule_cards,
            column=0,
            key="larvicide",
            title="Larvicide",
            description="Targets aquatic larvae",
            color="#23856d",
        )
        self._build_schedule_card(
            schedule_cards,
            column=1,
            key="insecticide",
            title="Insecticide",
            description="Targets adult mosquitoes",
            color="#d46b35",
        )
        self._build_schedule_card(
            schedule_cards,
            column=2,
            key="habitat",
            title="Habitat removal",
            description="Reduces breeding capacity",
            color="#6857a8",
        )

        self.log_text = tk.Text(
            log_tab,
            borderwidth=0,
            background="#f7f9fa",
            foreground=INK,
            font=("Consolas", 9),
            padx=14,
            pady=12,
            wrap="word",
            state="disabled",
        )
        self.log_text.pack(fill="both", expand=True)
        self._log("Application ready. Configure a run or load an existing results folder.")

    def _metric_card(self, parent: ttk.Frame, column: int, name: str, variable: tk.StringVar) -> None:
        card = ttk.Frame(parent, style="Card.TFrame")
        card.grid(row=0, column=column, sticky="nsew", padx=(0 if column == 0 else 5, 0 if column == 2 else 5))
        ttk.Label(card, textvariable=variable, style="Metric.TLabel").pack(anchor="w", padx=13, pady=(10, 0))
        ttk.Label(card, text=name, style="MetricName.TLabel").pack(anchor="w", padx=13, pady=(0, 10))

    def _build_schedule_card(
        self,
        parent: ttk.Frame,
        column: int,
        key: str,
        title: str,
        description: str,
        color: str,
    ) -> None:
        """Build one visually independent treatment timeline."""
        border = tk.Frame(parent, background=BORDER, padx=1, pady=1)
        border.grid(row=0, column=column, sticky="nsew", padx=4)
        card = tk.Frame(border, background=PANEL)
        card.pack(fill="both", expand=True)
        tk.Frame(card, background=color, height=5).pack(fill="x")

        heading = tk.Frame(card, background=PANEL)
        heading.pack(fill="x", padx=13, pady=(13, 2))
        tk.Label(
            heading,
            text=title,
            background=PANEL,
            foreground=INK,
            font=("Segoe UI Semibold", 11),
        ).pack(anchor="w")
        tk.Label(
            heading,
            text=description,
            background=PANEL,
            foreground=MUTED,
            font=("Segoe UI", 8),
        ).pack(anchor="w", pady=(1, 0))

        self.schedule_counts[key] = tk.StringVar(value="0 applications")
        tk.Label(
            card,
            textvariable=self.schedule_counts[key],
            background=color,
            foreground="white",
            font=("Segoe UI Semibold", 8),
            padx=8,
            pady=3,
        ).pack(anchor="w", padx=13, pady=(7, 10))

        self.schedule_details[key] = tk.StringVar(value="Duration and efficiency unavailable")
        tk.Label(
            card,
            textvariable=self.schedule_details[key],
            background=PALE_ACCENT,
            foreground=ACCENT_DARK,
            font=("Segoe UI Semibold", 8),
            justify="left",
            anchor="w",
            padx=8,
            pady=7,
        ).pack(fill="x", padx=10, pady=(0, 10))

        list_frame = tk.Frame(card, background="#f7f9fa")
        list_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        date_list = tk.Listbox(
            list_frame,
            borderwidth=0,
            highlightthickness=0,
            background="#f7f9fa",
            foreground=INK,
            selectbackground=color,
            selectforeground="white",
            activestyle="none",
            font=("Segoe UI", 9),
            exportselection=False,
        )
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=date_list.yview)
        date_list.configure(yscrollcommand=scrollbar.set)
        date_list.pack(side="left", fill="both", expand=True, padx=(4, 0), pady=5)
        scrollbar.pack(side="right", fill="y", pady=5)
        self.schedule_lists[key] = date_list

    def _build_status_bar(self) -> None:
        status = ttk.Frame(self, style="App.TFrame")
        status.pack(fill="x", padx=18, pady=(0, 10))
        self.progress = ttk.Progressbar(status, mode="indeterminate", length=140)
        self.progress.pack(side="left")
        ttk.Label(status, textvariable=self.status_text, style="Status.TLabel").pack(side="left", fill="x", expand=True, padx=10)

    # ----------------------------------------------------------- File/map IO
    @staticmethod
    def _browse_file(target: tk.StringVar) -> None:
        selected = filedialog.askopenfilename(
            title="Select climate data",
            filetypes=[("Supported data", "*.mat *.csv"), ("MATLAB data", "*.mat"), ("CSV data", "*.csv"), ("All files", "*.*")],
        )
        if selected:
            target.set(selected)

    @staticmethod
    def _browse_folder(target: tk.StringVar) -> None:
        selected = filedialog.askdirectory(title="Select results folder")
        if selected:
            target.set(selected)

    def _load_dates_from_csv(self, target: tk.StringVar) -> None:
        selected = filedialog.askopenfilename(
            title="Select a CSV of treatment dates",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
        )
        if not selected:
            return
        try:
            dates = self._read_dates_from_csv(Path(selected))
        except Exception as error:
            messagebox.showerror(
                "Cannot read dates",
                f"Could not read treatment dates from:\n{selected}\n\n{error}",
                parent=self,
            )
            return
        target.set(", ".join(dates))
        self._log(f"Loaded {len(dates)} treatment date(s) from {selected}")

    @staticmethod
    def _read_dates_from_csv(path: Path) -> list[str]:
        column = pd.read_csv(path, header=None)[0]
        dates = pd.to_datetime(column, errors="coerce").dropna()
        if dates.empty:
            raise ValueError("The file does not contain any recognizable YYYY-MM-DD dates.")
        return sorted(dates.dt.strftime("%Y-%m-%d").tolist())

    def _open_map(self, variables: dict[str, tk.StringVar]) -> None:
        try:
            from tkintermapview import TkinterMapView
        except ImportError:
            messagebox.showerror("Map unavailable", "Install tkintermapview to use the location picker.", parent=self)
            return

        try:
            latitude = float(variables["latitude"].get())
            longitude = float(variables["longitude"].get())
        except ValueError:
            latitude, longitude = 25.84, -80.26

        dialog = tk.Toplevel(self)
        dialog.title("Select model location")
        dialog.geometry("880x640")
        dialog.transient(self)
        header = tk.Frame(dialog, background="#12313b", height=54)
        header.pack(fill="x")
        header.pack_propagate(False)
        tk.Label(
            header,
            text="Right-click the map and choose “Use this location”",
            background="#12313b",
            foreground="white",
            font=("Segoe UI Semibold", 10),
        ).pack(side="left", padx=18, pady=16)

        map_view = TkinterMapView(dialog, width=880, height=586, corner_radius=0)
        map_view.pack(fill="both", expand=True)
        map_view.set_position(latitude, longitude)
        map_view.set_zoom(6)
        marker = map_view.set_marker(latitude, longitude, text="Selected location")

        def select_location(coords: tuple[float, float]) -> None:
            nonlocal marker
            selected_latitude, selected_longitude = coords
            variables["latitude"].set(f"{selected_latitude:.6f}")
            variables["longitude"].set(f"{selected_longitude:.6f}")
            marker.delete()
            marker = map_view.set_marker(selected_latitude, selected_longitude, text="Selected location")

        map_view.add_right_click_menu_command(label="Use this location", command=select_location, pass_coords=True)

    # -------------------------------------------------------------- Run model
    def _start_optimization(self) -> None:
        if self._running:
            return
        try:
            values = self._validated_values(self.optimization_vars, fixed=False)
        except ValueError as error:
            messagebox.showerror("Check the inputs", str(error), parent=self)
            return
        self._start_worker("Optimization", Optimize_AEDES_AEGYPTI, values)

    def _start_schedule(self) -> None:
        if self._running:
            return
        try:
            values = self._validated_values(self.schedule_vars, fixed=True)
        except ValueError as error:
            messagebox.showerror("Check the inputs", str(error), parent=self)
            return
        self._start_worker("Fixed schedule", Run_AEDES_AEGYPTI, values)

    def _validated_values(self, variables: dict[str, tk.StringVar], fixed: bool) -> dict[str, str]:
        values = {key: variable.get().strip() for key, variable in variables.items()}
        required = ["longitude", "latitude", "len_ins", "len_lr", "len_cr", "ls_ef", "is_ef", "cl_ef", "adtemp", "adpre", "adsave"]
        if not fixed:
            required.extend(["numtrls", "numtris", "numtrcl"])
        missing = [key for key in required if not values.get(key)]
        if missing:
            raise ValueError("Complete all required fields before running.")

        try:
            latitude = float(values["latitude"])
            longitude = float(values["longitude"])
        except ValueError as error:
            raise ValueError("Latitude and longitude must be numbers.") from error
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise ValueError("Latitude must be −90 to 90 and longitude must be −180 to 180.")

        for key, label in (("len_ins", "Insecticide duration"), ("len_lr", "Larvicide duration"), ("len_cr", "Habitat-removal duration")):
            try:
                if float(values[key]) < 0:
                    raise ValueError
            except ValueError as error:
                raise ValueError(f"{label} must be a non-negative number.") from error

        for key, label in (("is_ef", "Insecticide efficiency"), ("ls_ef", "Larvicide efficiency"), ("cl_ef", "Habitat-removal efficiency")):
            try:
                efficiency = float(values[key])
            except ValueError as error:
                raise ValueError(f"{label} must be a number from 0 to 1.") from error
            if not 0 <= efficiency <= 1:
                raise ValueError(f"{label} must be from 0 to 1.")

        if fixed:
            parsed_dates = []
            for key in ("larvicide_dates", "insecticide_dates", "habitat_dates"):
                for date_text in [item.strip() for item in values.get(key, "").split(",") if item.strip()]:
                    try:
                        parsed_dates.append(datetime.strptime(date_text, "%Y-%m-%d"))
                    except ValueError as error:
                        raise ValueError(f"‘{date_text}’ is not a valid YYYY-MM-DD date.") from error
            uses_csv_calendar = values["adtemp"].lower().endswith(".csv") or values["adpre"].lower().endswith(".csv")
            if not uses_csv_calendar:
                treatment_years = sorted({date.year for date in parsed_dates})
                if len(treatment_years) > 1:
                    years_text = ", ".join(str(year) for year in treatment_years)
                    raise ValueError(
                        "MATLAB climate data represents one annual cycle. All treatment "
                        f"dates must use the same year; found {years_text}. Please update the dates."
                    )
        else:
            for key, label in (("numtris", "Insecticide applications"), ("numtrls", "Larvicide applications"), ("numtrcl", "Habitat-removal applications")):
                try:
                    if int(values[key]) < 0 or str(int(values[key])) != values[key]:
                        raise ValueError
                except ValueError as error:
                    raise ValueError(f"{label} must be a non-negative whole number.") from error

        return values

    def _start_worker(self, label: str, function: object, values: dict[str, str]) -> None:
        self._running = True
        self.optimize_button.state(["disabled"])
        self.schedule_button.state(["disabled"])
        self.progress.start(12)
        self.status_text.set(f"{label} is running… This may take several minutes.")
        self._log(f"{label} started. Output: {self._display_path(values['adsave'])}")

        def work() -> None:
            try:
                function(**values)
            except Exception as error:  # The exception is displayed on the Tk thread.
                self._events.put(("error", (label, error)))
            else:
                self._events.put(("complete", (label, values["adsave"])))

        threading.Thread(target=work, name=f"aedes-{label.lower().replace(' ', '-')}", daemon=True).start()

    def _process_events(self) -> None:
        try:
            while True:
                event, payload = self._events.get_nowait()
                self._finish_run()
                if event == "complete":
                    label, folder = payload
                    self.status_text.set(f"{label} completed successfully.")
                    self._log(f"{label} completed successfully.")
                    try:
                        self._load_results(Path(folder))
                    except Exception as error:
                        self._log(f"The run finished, but results could not be displayed: {error}")
                        messagebox.showwarning(
                            "Run completed",
                            f"The model completed, but the dashboard could not load its output:\n\n{error}",
                            parent=self,
                        )
                else:
                    label, error = payload
                    self.status_text.set(f"{label} failed.")
                    self._log(f"ERROR — {label} failed: {type(error).__name__}: {error}")
                    messagebox.showerror("Model error", f"{label} failed:\n\n{error}", parent=self)
        except queue.Empty:
            pass
        finally:
            self.after(100, self._process_events)

    def _finish_run(self) -> None:
        self._running = False
        self.progress.stop()
        self.optimize_button.state(["!disabled"])
        self.schedule_button.state(["!disabled"])

    # ----------------------------------------------------------- Show results
    def _choose_results(self) -> None:
        selected = filedialog.askdirectory(title="Select an Aedes results folder")
        if selected:
            try:
                self._load_results(Path(selected))
            except Exception as error:
                messagebox.showerror("Cannot load results", str(error), parent=self)

    def _refresh_active_results(self) -> None:
        current = self.active_output.get()
        if current == "No result folder loaded":
            self._choose_results()
            return
        try:
            self._load_results(Path(current))
        except Exception as error:
            messagebox.showerror("Cannot refresh results", str(error), parent=self)

    def _load_results(self, folder: Path) -> None:
        folder = folder.expanduser()
        if not folder.is_absolute():
            folder = (Path.cwd() / folder).resolve()
        if not folder.is_dir():
            raise FileNotFoundError(f"Results folder not found:\n{folder}")

        dates = self._read_dates(folder / "dates.txt")
        population_before = self._read_numbers(folder / "population_before.txt")
        population_after = self._read_numbers(folder / "population_after.txt")
        risk_before = self._read_numbers(folder / "risk_before.txt")
        risk_after = self._read_numbers(folder / "risk_after.txt")
        series = (population_before, population_after, risk_before, risk_after)
        expected = len(dates)
        if any(len(item) != expected for item in series):
            raise ValueError("Result files do not contain the same number of rows.")

        self._draw_results(dates, population_before, population_after, risk_before, risk_after)
        self._load_schedule(folder)
        self.active_output.set(str(folder))
        self.metric_population.set(self._reduction_text(population_before, population_after, use_mean=True))
        self.metric_risk.set(self._reduction_text(risk_before, risk_after, use_mean=False))
        self.metric_days.set(f"{len(dates):,}")
        self.status_text.set("Results loaded.")
        self._log(f"Loaded {len(dates):,} daily results from {folder}")

    @staticmethod
    def _read_dates(path: Path) -> pd.DatetimeIndex:
        if not path.is_file():
            raise FileNotFoundError(f"Missing required result file: {path.name}")
        values = pd.read_csv(path, header=None)[0]
        dates = pd.to_datetime(values, errors="coerce")
        if dates.isna().any():
            raise ValueError(f"{path.name} contains an invalid date.")
        return pd.DatetimeIndex(dates)

    @staticmethod
    def _read_numbers(path: Path) -> np.ndarray:
        if not path.is_file():
            raise FileNotFoundError(f"Missing required result file: {path.name}")
        values = pd.to_numeric(pd.read_csv(path, header=None)[0], errors="coerce").to_numpy(dtype=float)
        return values

    @staticmethod
    def _reduction_text(before: np.ndarray, after: np.ndarray, use_mean: bool) -> str:
        summary = np.nanmean if use_mean else np.nanmax
        initial = float(summary(before))
        final = float(summary(after))
        if not np.isfinite(initial) or initial == 0:
            return "—"
        reduction = (initial - final) / initial * 100
        return f"{reduction:.1f}%"

    # -------------------------------------------------------- Plot navigation
    def _disable_toolbar_mode(self) -> None:
        """Turn off Matplotlib pan/zoom so custom date selection can receive drags."""
        mode = str(self.plot_toolbar.mode).lower()
        if "pan" in mode:
            self.plot_toolbar.pan()
        elif "zoom" in mode:
            self.plot_toolbar.zoom()

    def _activate_plot_tool(self, tool: str) -> None:
        if self._plot_limits is None:
            self.status_text.set("Load results before using plot tools.")
            return
        self._set_date_selection(False)
        self._disable_toolbar_mode()
        if tool == "pan":
            self.plot_toolbar.pan()
            self.status_text.set("Pan enabled — drag either chart to move through the timeline.")
        else:
            self.plot_toolbar.zoom()
            self.status_text.set("Box zoom enabled — drag a rectangle around the area to inspect.")

    def _toggle_date_selection(self) -> None:
        if self._plot_limits is None:
            self.status_text.set("Load results before selecting a date window.")
            return
        self._set_date_selection(not self._date_select_mode)

    def _set_date_selection(self, enabled: bool) -> None:
        self._date_select_mode = enabled
        self._selection_start = None
        self._remove_selection_patches()
        if enabled:
            self._disable_toolbar_mode()
            self.date_select_text.set("Selecting dates…")
            self.status_text.set("Date selection enabled — drag horizontally across either chart.")
        else:
            self.date_select_text.set("Select date window")

    def _reset_plot_view(self) -> None:
        if self._plot_limits is None:
            self.status_text.set("Load results before resetting the plot.")
            return
        self._set_date_selection(False)
        self._disable_toolbar_mode()
        x_limits, population_limits, risk_limits = self._plot_limits
        self.population_axis.set_xlim(x_limits)
        self.population_axis.set_ylim(population_limits)
        self.risk_axis.set_ylim(risk_limits)
        self.plot_toolbar.update()
        self.plot_canvas.draw_idle()
        self.status_text.set("Full result period restored.")

    def _on_plot_scroll(self, event: object) -> None:
        """Zoom the shared date axis around the mouse position."""
        if self._plot_limits is None or event.inaxes not in (self.population_axis, self.risk_axis) or event.xdata is None:
            return
        current_left, current_right = self.risk_axis.get_xlim()
        full_left, full_right = self._plot_limits[0]
        factor = 0.72 if event.button == "up" else 1.38
        new_width = min(full_right - full_left, max(2.0, (current_right - current_left) * factor))
        mouse_fraction = (event.xdata - current_left) / max(current_right - current_left, 1e-12)
        new_left = event.xdata - new_width * mouse_fraction
        new_right = new_left + new_width
        if new_left < full_left:
            new_right += full_left - new_left
            new_left = full_left
        if new_right > full_right:
            new_left -= new_right - full_right
            new_right = full_right
        self.population_axis.set_xlim(new_left, new_right)
        self.plot_canvas.draw_idle()

    def _on_plot_press(self, event: object) -> None:
        if (
            not self._date_select_mode
            or event.button != 1
            or event.inaxes not in (self.population_axis, self.risk_axis)
            or event.xdata is None
        ):
            return
        self._selection_start = float(event.xdata)

    def _on_plot_motion(self, event: object) -> None:
        if not self._date_select_mode or self._selection_start is None or event.xdata is None:
            return
        self._remove_selection_patches(redraw=False)
        left, right = sorted((self._selection_start, float(event.xdata)))
        for axis in (self.population_axis, self.risk_axis):
            self._selection_patches.append(axis.axvspan(left, right, color=ACCENT, alpha=0.16, zorder=0))
        self.plot_canvas.draw_idle()

    def _on_plot_release(self, event: object) -> None:
        if not self._date_select_mode or self._selection_start is None:
            return
        start = self._selection_start
        self._selection_start = None
        self._remove_selection_patches(redraw=False)
        if event.xdata is None:
            self.plot_canvas.draw_idle()
            return
        left, right = sorted((start, float(event.xdata)))
        if right - left < 1.0:
            self.plot_canvas.draw_idle()
            return
        self.population_axis.set_xlim(left, right)
        self.plot_canvas.draw_idle()
        start_text = mdates.num2date(left).strftime("%b %d, %Y")
        end_text = mdates.num2date(right).strftime("%b %d, %Y")
        self.status_text.set(f"Showing {start_text} through {end_text}.")

    def _remove_selection_patches(self, redraw: bool = True) -> None:
        for patch in self._selection_patches:
            try:
                patch.remove()
            except ValueError:
                pass
        self._selection_patches.clear()
        if redraw and hasattr(self, "plot_canvas"):
            self.plot_canvas.draw_idle()

    @staticmethod
    def _compact_count(value: float, _position: int) -> str:
        """Format large population ticks as 450K, 2.5M, or 30M."""
        absolute = abs(value)
        for size, suffix in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
            if absolute >= size:
                scaled = value / size
                decimals = 0 if abs(scaled) >= 10 or np.isclose(scaled, round(scaled)) else 1
                return f"{scaled:.{decimals}f}{suffix}"
        if absolute >= 10 or np.isclose(value, round(value)):
            return f"{value:.0f}"
        return f"{value:.1f}"

    @staticmethod
    def _risk_tick_formatter(before: np.ndarray, after: np.ndarray) -> FuncFormatter:
        finite = np.concatenate((before[np.isfinite(before)], after[np.isfinite(after)]))
        if not finite.size:
            return FuncFormatter(lambda value, _position: f"{value:g}")
        data_range = float(np.nanmax(finite) - min(0.0, float(np.nanmin(finite))))
        approximate_step = data_range / 5.0
        if 0 < approximate_step < 1e-5:
            return FuncFormatter(lambda value, _position: "0" if np.isclose(value, 0) else f"{value:.1e}")
        decimals = max(2, min(6, int(np.ceil(-np.log10(max(approximate_step, 1e-12)))) + 1))
        return FuncFormatter(lambda value, _position: f"{value:.{decimals}f}")

    def _draw_empty_plot(self) -> None:
        self._plot_limits = None
        for axis, title in ((self.population_axis, "Mosquito population"), (self.risk_axis, "Transmission risk")):
            axis.clear()
            axis.set_facecolor("#fbfcfd")
            axis.text(0.5, 0.5, "Run a model or load results to begin", transform=axis.transAxes, ha="center", va="center", color=MUTED)
            axis.set_title(title, loc="left", color=INK, fontsize=11, fontweight="semibold")
            axis.set_xticks([])
            axis.set_yticks([])
            for spine in axis.spines.values():
                spine.set_color(BORDER)
        self.plot_canvas.draw_idle()

    def _draw_results(
        self,
        dates: pd.DatetimeIndex,
        population_before: np.ndarray,
        population_after: np.ndarray,
        risk_before: np.ndarray,
        risk_after: np.ndarray,
    ) -> None:
        plots = [
            (self.population_axis, population_before, population_after, "Mosquito population", "Adult mosquitoes", "population"),
            (self.risk_axis, risk_before, risk_after, "Transmission risk", "Risk index", "risk"),
        ]
        for axis, before, after, title, ylabel, plot_kind in plots:
            axis.clear()
            axis.set_facecolor("#fbfcfd")
            axis.plot(dates, before, color=BLUE, linewidth=1.8, label="Before control")
            axis.plot(dates, after, color=ORANGE, linewidth=1.8, label="After control")
            valid = np.isfinite(before) & np.isfinite(after)
            axis.fill_between(dates, before, after, where=valid, color=ACCENT, alpha=0.08)
            axis.set_title(title, loc="left", color=INK, fontsize=11, fontweight="semibold")
            axis.set_ylabel(ylabel, color=MUTED, fontsize=9)
            axis.grid(axis="y", color=BORDER, linewidth=0.7, alpha=0.8)
            axis.tick_params(colors=MUTED, labelsize=8)
            axis.spines["top"].set_visible(False)
            axis.spines["right"].set_visible(False)
            axis.spines["left"].set_color(BORDER)
            axis.spines["bottom"].set_color(BORDER)
            axis.yaxis.set_major_locator(MaxNLocator(nbins=6, min_n_ticks=3))
            if plot_kind == "population":
                axis.yaxis.set_major_formatter(FuncFormatter(self._compact_count))
            else:
                axis.yaxis.set_major_formatter(self._risk_tick_formatter(before, after))
            axis.set_ylim(bottom=0)
            axis.legend(frameon=False, loc="upper right", ncol=2, fontsize=8)
        self.risk_axis.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=9))
        self.risk_axis.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
        self.risk_axis.set_xlabel("Date", color=MUTED, fontsize=9)
        self.figure.autofmt_xdate(rotation=0, ha="center")
        self._plot_limits = (
            self.risk_axis.get_xlim(),
            self.population_axis.get_ylim(),
            self.risk_axis.get_ylim(),
        )
        self.plot_toolbar.update()
        self.plot_canvas.draw_idle()

    def _load_schedule(self, folder: Path) -> None:
        treatments: dict[str, object] = {}
        metadata: dict[str, object] = {}
        metadata_path = folder / "run_metadata.json"
        if metadata_path.is_file():
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                treatments = metadata.get("treatments", {})
            except (OSError, json.JSONDecodeError, AttributeError) as error:
                self._log(f"Could not read {metadata_path.name}: {error}")

        if metadata.get("simulation_start") and metadata.get("simulation_end"):
            source_label = "CSV calendar" if metadata.get("date_source") == "csv" else "MATLAB annual climatology"
            self.calendar_summary.set(
                f"{source_label}  •  Simulation period: "
                f"{metadata['simulation_start']} through {metadata['simulation_end']}"
            )
        else:
            self.calendar_summary.set("Calendar metadata unavailable. Run the model again to create it.")

        schedule_files = [
            ("larvicide", folder / "larvicide_application_dates.txt"),
            ("insecticide", folder / "insecticide_application_dates.txt"),
            ("habitat", folder / "habitat_removal_application_dates.txt"),
        ]
        for key, path in schedule_files:
            date_list = self.schedule_lists[key]
            date_list.delete(0, "end")
            lines: list[str] = []
            if path.is_file():
                lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

            for date_text in lines:
                try:
                    display_date = pd.to_datetime(date_text).strftime("%a, %b %d, %Y")
                except (TypeError, ValueError):
                    display_date = date_text
                date_list.insert("end", display_date)

            count = len(lines)
            self.schedule_counts[key].set(f"{count} application" if count == 1 else f"{count} applications")
            if not lines:
                date_list.insert("end", "No applications scheduled")

            settings = treatments.get(key, {}) if isinstance(treatments, dict) else {}
            if isinstance(settings, dict) and "duration_days" in settings and "efficiency" in settings:
                duration = self._plain_number(settings["duration_days"])
                efficiency = self._plain_number(settings["efficiency"])
                self.schedule_details[key].set(
                    f"Duration  {duration} days\nEfficiency  {efficiency}"
                )
            else:
                self.schedule_details[key].set("Duration and efficiency unavailable\nRun again to create metadata")

    @staticmethod
    def _plain_number(value: object) -> str:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return str(value)
        return f"{number:g}"

    def _log(self, message: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{timestamp}]  {message}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    @staticmethod
    def _display_path(path_text: str) -> str:
        path = Path(path_text).expanduser()
        if not path.is_absolute():
            path = Path.cwd() / path
        return os.fspath(path)


def main() -> None:
    app = AedesControlApp()
    app.mainloop()


if __name__ == "__main__":
    main()
