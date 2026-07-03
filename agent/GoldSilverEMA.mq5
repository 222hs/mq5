//+------------------------------------------------------------------+
//|                                               GoldSilverEMA.mq5  |
//|                    XAUUSD / XAGUSD — EMA Crossover Scalper       |
//|                    TP/SL configurable | Session filter            |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- ══════════════════════════════════════════════
input group "═══ إعدادات الصفقة ═══"
input double InpLotSize          = 0.1;    // حجم اللوت
input int    InpTakeProfitPoints = 150;    // TP بالنقاط
input int    InpStopLossPoints   = 100;    // SL بالنقاط
input bool   InpUseTrailingStop  = false;  // تفعيل Trailing Stop
input int    InpTrailingPoints   = 50;     // Trailing Stop بالنقاط

input group "═══ إعدادات EMA ═══"
input int    InpEMA_Fast         = 8;      // EMA السريع
input int    InpEMA_Slow         = 21;     // EMA البطيء
input int    InpEMA_Trend        = 50;     // EMA الاتجاه (0=معطّل)

input group "═══ فلاتر السوق ═══"
input int    InpMaxSpread        = 50;     // أقصى سبريد مقبول (نقاط)
input int    InpMinCandleBody    = 5;      // أدنى حجم جسم الشمعة (نقاط)
input int    InpMaxPositions     = 2;      // أقصى عدد صفقات مفتوحة

input group "═══ فلتر الجلسات (UTC) ═══"
input bool   InpUseSession       = true;
input int    InpSessionStart     = 7;      // بداية لندن
input int    InpSessionEnd       = 21;     // نهاية نيويورك

input group "═══ حدود يومية ═══"
input double InpMaxDailyLoss     = 0.0;   // أقصى خسارة يومية (0=معطّل)
input double InpMaxDailyProfit   = 0.0;   // أقصى ربح يومي (0=معطّل)

input group "═══ إعدادات عامة ═══"
input int    InpMagicNumber      = 99201;
input bool   InpShowPanel        = true;   // إظهار لوحة المعلومات

//--- ══════════════════════════════════════════════
CTrade        trade;
CPositionInfo posInfo;

int    hFast, hSlow, hTrend;
datetime g_lastBar    = 0;
double   g_dayStart   = 0.0;
datetime g_dayDate    = 0;
int      g_wins       = 0;
int      g_losses     = 0;
double   g_totalPL    = 0.0;
int      g_totalTrades= 0;

//--- Panel
#define DP  "GSE_"
#define PX  10
#define PY  10
#define PW  260
#define RH  20

//+------------------------------------------------------------------+
void DLabel(string id, string txt, int x, int y, color clr, int fs=9)
  {
   string nm = DP+id;
   if(ObjectFind(0,nm)<0)
     {
      ObjectCreate(0,nm,OBJ_LABEL,0,0,0);
      ObjectSetInteger(0,nm,OBJPROP_CORNER,CORNER_LEFT_UPPER);
      ObjectSetInteger(0,nm,OBJPROP_SELECTABLE,false);
      ObjectSetString(0,nm,OBJPROP_FONT,"Courier New");
     }
   ObjectSetString(0,nm,OBJPROP_TEXT,txt);
   ObjectSetInteger(0,nm,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,nm,OBJPROP_COLOR,clr);
   ObjectSetInteger(0,nm,OBJPROP_FONTSIZE,fs);
  }

void DRect(string id, int x, int y, int w, int h, color bg, color border)
  {
   string nm=DP+id;
   if(ObjectFind(0,nm)<0) ObjectCreate(0,nm,OBJ_RECTANGLE_LABEL,0,0,0);
   ObjectSetInteger(0,nm,OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,nm,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,nm,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,nm,OBJPROP_XSIZE,w);
   ObjectSetInteger(0,nm,OBJPROP_YSIZE,h);
   ObjectSetInteger(0,nm,OBJPROP_BGCOLOR,bg);
   ObjectSetInteger(0,nm,OBJPROP_BORDER_COLOR,border);
   ObjectSetInteger(0,nm,OBJPROP_SELECTABLE,false);
   ObjectSetInteger(0,nm,OBJPROP_BACK,false);
  }

void UpdatePanel()
  {
   if(!InpShowPanel) return;
   int rows = 13;
   int panH = PY + 30 + rows*RH + 10;
   DRect("bg", PX, PY, PW, panH, C'10,10,20', C'60,60,90');

   int y = PY+8;
   DLabel("title", "GoldSilverEMA  v1.00", PX+8, y, C'100,180,255', 10);
   y += 22;
   DLabel("sym",   "Symbol : "+_Symbol,    PX+8, y, clrSilver);
   y += RH;

   // EMA info
   double emaF[1], emaS[1], emaT[1];
   string emaStatus = "---";
   if(CopyBuffer(hFast,0,0,1,emaF)>0 && CopyBuffer(hSlow,0,0,1,emaS)>0)
     {
      if(emaF[0] > emaS[0]) emaStatus = "BULL  ▲";
      else                   emaStatus = "BEAR  ▼";
     }
   color eClr = (emaStatus[0]=='B' && emaStatus[5]=='▲') ? clrLime : clrOrangeRed;
   DLabel("ema",  "EMA    : "+emaStatus,   PX+8, y, eClr); y += RH;

   // Session
   bool sess = SessionOK();
   DLabel("sess","Session: "+(sess?"OPEN":"CLOSED"), PX+8, y, sess?clrLime:clrGray); y += RH;

   // Spread
   long sp = SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   color spC = (sp<=InpMaxSpread)?clrLime:clrOrangeRed;
   DLabel("sp",  "Spread : "+IntegerToString((int)sp)+" pts", PX+8, y, spC); y += RH;

   // Positions
   int pos = CountPos();
   DLabel("pos", "Pos    : "+IntegerToString(pos)+"/"+IntegerToString(InpMaxPositions),
          PX+8, y, pos>0?clrDeepSkyBlue:clrSilver); y += RH;

   // Float P&L
   double fpl = FloatPL();
   color fc = fpl>=0?clrLime:clrOrangeRed;
   DLabel("fpl", "Float  : "+DoubleToString(fpl,2)+" $", PX+8, y, fc); y += RH;

   // Stats
   DLabel("tot", "Trades : "+IntegerToString(g_totalTrades), PX+8, y, clrSilver); y += RH;
   DLabel("win", "Wins   : "+IntegerToString(g_wins),        PX+8, y, clrLime);   y += RH;
   DLabel("los", "Losses : "+IntegerToString(g_losses),      PX+8, y, clrOrangeRed); y += RH;
   double wr = (g_totalTrades>0)?(double)g_wins/g_totalTrades*100.0:0.0;
   DLabel("wr",  "WinRate: "+DoubleToString(wr,1)+"%",       PX+8, y, wr>=50?clrLime:clrOrangeRed); y += RH;
   DLabel("pl",  "Net P&L: "+DoubleToString(g_totalPL,2)+" $", PX+8, y,
          g_totalPL>=0?clrLime:clrOrangeRed); y += RH;

   // TP/SL reminder
   DLabel("tpsl","TP="+IntegerToString(InpTakeProfitPoints)+"pt  SL="+IntegerToString(InpStopLossPoints)+"pt",
          PX+8, y, C'80,80,120'); y += RH;

   ChartRedraw(0);
  }

void RemovePanel()
  {
   ObjectsDeleteAll(0, DP);
  }

//+------------------------------------------------------------------+
bool SessionOK()
  {
   if(!InpUseSession) return true;
   MqlDateTime dt; TimeToStruct(TimeGMT(),dt);
   return (dt.hour >= InpSessionStart && dt.hour < InpSessionEnd);
  }

int CountPos()
  {
   int n=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==InpMagicNumber) n++;
   return n;
  }

double FloatPL()
  {
   double pl=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==InpMagicNumber)
            pl += posInfo.Profit()+posInfo.Swap();
   return pl;
  }

double NormLot(double lot)
  {
   double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(st>0) lot=MathFloor(lot/st)*st;
   return MathMax(mn,MathMin(mx,lot));
  }

void InitDayBalance()
  {
   MqlDateTime dt; TimeToStruct(TimeCurrent(),dt);
   datetime today = StringToTime(StringFormat("%04d.%02d.%02d 00:00",dt.year,dt.mon,dt.day));
   if(today != g_dayDate)
     { g_dayDate=today; g_dayStart=AccountInfoDouble(ACCOUNT_BALANCE); }
  }

bool DailyLimitHit()
  {
   if(InpMaxDailyLoss==0.0 && InpMaxDailyProfit==0.0) return false;
   double diff = AccountInfoDouble(ACCOUNT_BALANCE) - g_dayStart;
   if(InpMaxDailyLoss>0   && diff <= -InpMaxDailyLoss)   return true;
   if(InpMaxDailyProfit>0 && diff >=  InpMaxDailyProfit) return true;
   return false;
  }

void ManageTrailing()
  {
   if(!InpUseTrailingStop) return;
   double pt = SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   double tickSize = SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   double trailDist = InpTrailingPoints * tickSize;

   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol || posInfo.Magic()!=InpMagicNumber) continue;
      double curSL  = posInfo.StopLoss();
      double price  = posInfo.PriceCurrent();
      ulong  tk     = posInfo.Ticket();

      if(posInfo.PositionType()==POSITION_TYPE_BUY)
        {
         double newSL = NormalizeDouble(price - trailDist, _Digits);
         if(newSL > curSL + pt) trade.PositionModify(tk, newSL, posInfo.TakeProfit());
        }
      else
        {
         double newSL = NormalizeDouble(price + trailDist, _Digits);
         if(newSL < curSL - pt || curSL==0) trade.PositionModify(tk, newSL, posInfo.TakeProfit());
        }
     }
  }

void OpenTrade(ENUM_ORDER_TYPE type)
  {
   double tickSize   = SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   long   stopsLvl   = SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double minDist    = MathMax((double)(stopsLvl+10), 20.0) * tickSize;

   double slDist = MathMax(InpStopLossPoints   * tickSize, minDist);
   double tpDist = MathMax(InpTakeProfitPoints * tickSize, minDist);
   int    digs   = (int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   double lot    = NormLot(InpLotSize);

   double price, sl, tp;
   if(type==ORDER_TYPE_BUY)
     {
      price = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      sl = NormalizeDouble(price - slDist, digs);
      tp = NormalizeDouble(price + tpDist, digs);
     }
   else
     {
      price = SymbolInfoDouble(_Symbol,SYMBOL_BID);
      sl = NormalizeDouble(price + slDist, digs);
      tp = NormalizeDouble(price - tpDist, digs);
     }

   // نوع التعبئة التلقائي
   long fillMode = SymbolInfoInteger(_Symbol,SYMBOL_FILLING_MODE);
   ENUM_ORDER_TYPE_FILLING fill;
   if((fillMode & SYMBOL_FILLING_FOK)!=0)       fill = ORDER_FILLING_FOK;
   else if((fillMode & SYMBOL_FILLING_IOC)!=0)  fill = ORDER_FILLING_IOC;
   else                                          fill = ORDER_FILLING_RETURN;

   MqlTradeRequest req = {};
   MqlTradeResult  res = {};
   req.action       = TRADE_ACTION_DEAL;
   req.symbol       = _Symbol;
   req.volume       = lot;
   req.type         = type;
   req.price        = price;
   req.sl           = sl;
   req.tp           = tp;
   req.deviation    = 50;
   req.magic        = InpMagicNumber;
   req.type_filling = fill;
   req.comment      = "GSE_"+(type==ORDER_TYPE_BUY?"BUY":"SEL");

   if(OrderSend(req,res))
     { g_totalTrades++; Print("GSE: ",EnumToString(type)," #",res.order," sl=",sl," tp=",tp); }
   else
      Print("GSE: error ",GetLastError()," / ",res.retcode);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   hFast  = iMA(_Symbol,PERIOD_M1,InpEMA_Fast, 0,MODE_EMA,PRICE_CLOSE);
   hSlow  = iMA(_Symbol,PERIOD_M1,InpEMA_Slow, 0,MODE_EMA,PRICE_CLOSE);
   hTrend = (InpEMA_Trend>0) ? iMA(_Symbol,PERIOD_M1,InpEMA_Trend,0,MODE_EMA,PRICE_CLOSE) : INVALID_HANDLE;

   if(hFast==INVALID_HANDLE||hSlow==INVALID_HANDLE)
     { Print("GSE: EMA init failed"); return INIT_FAILED; }

   InitDayBalance();
   Print("GoldSilverEMA initialized | ",_Symbol," TP=",InpTakeProfitPoints," SL=",InpStopLossPoints,
         " EMA(",InpEMA_Fast,"/",InpEMA_Slow,")");
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   RemovePanel();
   IndicatorRelease(hFast);
   IndicatorRelease(hSlow);
   if(hTrend!=INVALID_HANDLE) IndicatorRelease(hTrend);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   ManageTrailing();
   UpdatePanel();

   // شمعة جديدة فقط
   datetime barTime = iTime(_Symbol,PERIOD_M1,0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   InitDayBalance();

   // فلاتر
   if(DailyLimitHit())                    return;
   if(!SessionOK())                        return;
   long sp = SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   if(sp > InpMaxSpread)                  return;
   if(CountPos() >= InpMaxPositions)      return;

   // بيانات EMA (شمعة مغلقة [1] و [2])
   double fast[3], slow[3];
   ArraySetAsSeries(fast,true); ArraySetAsSeries(slow,true);
   if(CopyBuffer(hFast,0,0,3,fast)<3) return;
   if(CopyBuffer(hSlow,0,0,3,slow)<3) return;

   // فلتر اتجاه EMA الكبير
   bool trendBull = true, trendBear = true;
   if(hTrend!=INVALID_HANDLE)
     {
      double trend[1]; ArraySetAsSeries(trend,true);
      if(CopyBuffer(hTrend,0,1,1,trend)>0)
        {
         double close1[1]; ArraySetAsSeries(close1,true);
         CopyClose(_Symbol,PERIOD_M1,1,1,close1);
         trendBull = (close1[0] > trend[0]);
         trendBear = (close1[0] < trend[0]);
        }
     }

   // فلتر حجم الشمعة
   double tickSize = SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   double minBody  = InpMinCandleBody * tickSize;
   double open1[1], close1[1];
   ArraySetAsSeries(open1,true); ArraySetAsSeries(close1,true);
   CopyOpen(_Symbol,PERIOD_M1,1,1,open1);
   CopyClose(_Symbol,PERIOD_M1,1,1,close1);
   double body = MathAbs(close1[0]-open1[0]);
   if(body < minBody) return;

   // إشارة Crossover: Fast تقطع Slow من الأسفل→BUY، من الأعلى→SELL
   bool crossUp   = (fast[2] <= slow[2]) && (fast[1] > slow[1]);
   bool crossDown = (fast[2] >= slow[2]) && (fast[1] < slow[1]);

   if(crossUp   && trendBull) OpenTrade(ORDER_TYPE_BUY);
   if(crossDown && trendBear) OpenTrade(ORDER_TYPE_SELL);
  }

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest     &req,
                        const MqlTradeResult      &res)
  {
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=(long)InpMagicNumber) return;
   long entry = HistoryDealGetInteger(trans.deal,DEAL_ENTRY);
   if(entry!=DEAL_ENTRY_OUT) return;
   double profit = HistoryDealGetDouble(trans.deal,DEAL_PROFIT)
                 + HistoryDealGetDouble(trans.deal,DEAL_SWAP)
                 + HistoryDealGetDouble(trans.deal,DEAL_COMMISSION);
   g_totalPL += profit;
   if(profit>=0) g_wins++; else g_losses++;
  }
//+------------------------------------------------------------------+
